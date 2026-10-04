//! Soloyard：侧栏「服务」分页的后端——列出工作区里监听端口的进程，停止 / 重启，读日志。
//!
//! 全靠系统命令（`ps`、`lsof`、`git worktree list`），不记状态：每次列表都重新扫一遍。
//! 一行是一个「启动进程」：从监听端口的进程往上找父进程，直到碰到 agent / 交互 shell、出了工作区，
//! 或者碰到本应用（我们重启起来的服务）。停止 / 重启都作用于这个进程和它的全部子进程。
//! 日志就是进程 stdout 指向的普通文件（agent 后台任务的 .output、`> x.log`）；输出在终端里的看不到。

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pid: u32,
    ports: Vec<u16>,
    command: String,
    cwd: String,
    /// 所在的工作区根目录（主仓库或某个 worktree）和它的分支。
    root: String,
    branch: Option<String>,
    started_at: u64,
    /// stdout 指向的普通文件；输出在终端 / 管道里时为空。
    log_path: Option<String>,
    /// 开发版自己（`npm run tauri dev`）：停掉会把应用关掉，不允许操作。
    is_self: bool,
}

struct Proc {
    ppid: u32,
    elapsed: u64,
    args: String,
}

fn run(cmd: &str, args: &[&str]) -> String {
    // lsof 碰到已退出的 pid 会返回非 0，但输出仍然有用，所以不看退出码。
    Command::new(cmd)
        .args(args)
        .stderr(Stdio::null())
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

/// `ps` 的 etime：`[[dd-]hh:]mm:ss`。
fn parse_etime(text: &str) -> u64 {
    let (days, rest) = match text.split_once('-') {
        Some((d, rest)) => (d.parse().unwrap_or(0), rest),
        None => (0, text),
    };
    let secs = rest.split(':').fold(0u64, |acc, part| acc * 60 + part.parse::<u64>().unwrap_or(0));
    days * 86400 + secs
}

fn processes() -> HashMap<u32, Proc> {
    run("ps", &["-axww", "-o", "pid=,ppid=,etime=,args="])
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let ppid = parts.next()?.parse().ok()?;
            let elapsed = parse_etime(parts.next()?);
            let args = parts.collect::<Vec<_>>().join(" ");
            Some((pid, Proc { ppid, elapsed, args }))
        })
        .collect()
}

/// pid → 监听的 TCP 端口。
fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut ports: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut pid = 0;
    for line in run("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]).lines() {
        if let Some(rest) = line.strip_prefix('p') {
            pid = rest.parse().unwrap_or(0);
        } else if let Some(port) = line.strip_prefix('n').and_then(|n| n.rsplit(':').next()?.parse().ok()) {
            let list = ports.entry(pid).or_default();
            if !list.contains(&port) {
                list.push(port);
            }
        }
    }
    ports
}

/// pid → (cwd, stdout 指向的普通文件)。
fn cwd_and_stdout(pids: &HashSet<u32>) -> HashMap<u32, (String, Option<String>)> {
    let mut out: HashMap<u32, (String, Option<String>)> = HashMap::new();
    if pids.is_empty() {
        return out;
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let (mut pid, mut fd, mut regular) = (0, String::new(), false);
    for line in run("lsof", &["-a", "-p", &list, "-d", "cwd,1", "-Fpftn"]).lines() {
        let (tag, value) = line.split_at(1.min(line.len()));
        match tag {
            "p" => pid = value.parse().unwrap_or(0),
            "f" => fd = value.to_string(),
            "t" => regular = value == "REG",
            "n" => {
                let entry = out.entry(pid).or_default();
                if fd == "cwd" {
                    entry.0 = value.to_string();
                } else if fd == "1" && regular {
                    entry.1 = Some(value.to_string());
                }
            }
            _ => {}
        }
    }
    out
}

/// 主仓库和它的 worktree：(路径, 分支)。不是 git 仓库就只有它自己。
fn workspace_roots(cwd: &str) -> Vec<(String, Option<String>)> {
    let mut roots = Vec::new();
    let mut path: Option<String> = None;
    for line in run("git", &["-C", cwd, "worktree", "list", "--porcelain"]).lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(prev) = path.take() {
                roots.push((prev, None));
            }
            path = Some(p.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(p) = path.take() {
                roots.push((p, Some(branch.trim_start_matches("refs/heads/").to_string())));
            }
        }
    }
    roots.extend(path.map(|p| (p, None)));
    // 只在 cwd 本身是仓库根 / worktree 时带上兄弟 worktree；cwd 是某个大仓库里的子目录（比如 ~/Playground 是仓库）就只看它自己。
    let same = |a: &str| std::fs::canonicalize(a).ok() == std::fs::canonicalize(cwd).ok();
    if !roots.iter().any(|(root, _)| same(root)) {
        return vec![(cwd.to_string(), None)];
    }
    roots
}

fn within(path: &str, root: &str) -> bool {
    // macOS 上 /tmp 是 /private/tmp 的链接，lsof 给的是真实路径。
    let canonical = std::fs::canonicalize(root).map(|p| p.to_string_lossy().into_owned());
    [root, canonical.as_deref().unwrap_or(root)].iter().any(|root| {
        let root = root.trim_end_matches('/');
        path == root || path.starts_with(&format!("{root}/"))
    })
}

fn program(args: &str) -> &str {
    let first = args.split_whitespace().next().unwrap_or("");
    first.rsplit('/').next().unwrap_or(first).trim_start_matches('-')
}

const SHELLS: &[&str] = &["zsh", "bash", "sh", "fish", "dash", "tcsh", "csh", "nu"];
/// 往上找时碰到这些就停：它们不属于服务（agent 本身、终端复用器、登录进程）。
const BOUNDARIES: &[&str] = &["claude", "codex", "tmux", "screen", "login", "sshd", "launchd"];

/// 从监听端口的进程往上找「启动进程」。`inside` 判断某个进程的 cwd 是否还在工作区里。
fn launch_pid(pid: u32, procs: &HashMap<u32, Proc>, inside: &dyn Fn(u32) -> bool) -> u32 {
    let me = std::process::id();
    let mut current = pid;
    loop {
        let Some(parent) = procs.get(&current).map(|p| p.ppid) else { return current };
        let Some(parent_proc) = procs.get(&parent) else { return current };
        let name = program(&parent_proc.args);
        if parent <= 1 || parent == me || BOUNDARIES.contains(&name) || !inside(parent) {
            return current;
        }
        if SHELLS.contains(&name) {
            // `sh -c vite` 这种是 npm / pnpm 起的，透明；交互 shell、agent 起的 shell 就是边界。
            let script_shell = parent_proc.args.split_whitespace().any(|a| a == "-c");
            let Some(grand) = procs.get(&parent_proc.ppid) else { return current };
            let grand_name = program(&grand.args);
            if !script_shell
                || parent_proc.ppid <= 1
                || parent_proc.ppid == me
                || SHELLS.contains(&grand_name)
                || BOUNDARIES.contains(&grand_name)
                || !inside(parent_proc.ppid)
            {
                return current;
            }
        }
        current = parent;
    }
}

fn ancestors(pid: u32, procs: &HashMap<u32, Proc>) -> Vec<u32> {
    let mut chain = vec![pid];
    let mut current = pid;
    while let Some(parent) = procs.get(&current).map(|p| p.ppid).filter(|&p| p > 1 && !chain.contains(&p)) {
        chain.push(parent);
        current = parent;
    }
    chain
}

fn descendants(pid: u32, procs: &HashMap<u32, Proc>) -> Vec<u32> {
    let mut found = vec![pid];
    let mut i = 0;
    while i < found.len() {
        let current = found[i];
        found.extend(procs.iter().filter(|(_, p)| p.ppid == current).map(|(&child, _)| child));
        i += 1;
    }
    found
}

#[tauri::command(async)]
pub fn soloyard_services_list(app: AppHandle, cwd: String) -> Vec<Service> {
    let ours = services_dir(&app).ok();
    let roots = workspace_roots(&cwd);
    let procs = processes();
    let ports = listening_ports();
    let me = std::process::id();

    // 监听进程和它们（以及本应用）的祖先，一次 lsof 拿全 cwd。
    let mut wanted: HashSet<u32> = ports.keys().flat_map(|&pid| ancestors(pid, &procs)).collect();
    wanted.extend(ancestors(me, &procs));
    let info = cwd_and_stdout(&wanted);
    let root_of = |pid: u32| {
        let cwd = &info.get(&pid)?.0;
        roots.iter().filter(|(root, _)| within(cwd, root)).max_by_key(|(root, _)| root.len())
    };
    let inside = |pid: u32| root_of(pid).is_some();
    let self_launch = launch_pid(me, &procs, &inside);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);

    let mut services: HashMap<u32, Service> = HashMap::new();
    for (&pid, pid_ports) in &ports {
        if !inside(pid) {
            continue;
        }
        let launch = launch_pid(pid, &procs, &inside);
        let service = services.entry(launch).or_insert_with(|| {
            let (root, branch) = root_of(launch).or_else(|| root_of(pid)).cloned().unwrap_or_default();
            let launch_info = info.get(&launch);
            Service {
                pid: launch,
                ports: Vec::new(),
                command: procs.get(&launch).map(|p| p.args.clone()).unwrap_or_default(),
                cwd: launch_info.map(|i| i.0.clone()).unwrap_or_default(),
                root,
                branch,
                started_at: now.saturating_sub(procs.get(&launch).map_or(0, |p| p.elapsed)),
                log_path: launch_info.and_then(|i| i.1.clone()).or_else(|| info.get(&pid).and_then(|i| i.1.clone())),
                is_self: launch == self_launch || launch == me,
            }
        });
        for &port in pid_ports {
            if !service.ports.contains(&port) {
                service.ports.push(port);
            }
        }
    }
    let mut list: Vec<Service> = services.into_values().collect();
    for service in &mut list {
        service.ports.sort_unstable();
        // 我们起的服务：用启动时的原始目录和命令（ps 给的丢了引号和环境变量，也和历史对不上）。
        let meta = service.log_path.as_deref().filter(|log| ours.as_ref().is_some_and(|dir| Path::new(log).starts_with(dir)));
        if let Some(Launch { cwd, command }) = meta.and_then(|log| read_launch(Path::new(log))) {
            service.cwd = cwd;
            service.command = command;
        }
    }
    list.sort_by_key(|s| s.ports.first().copied().unwrap_or(0));
    list
}

fn alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// 先 SIGTERM 整棵进程树，3 秒没退干净再 SIGKILL。
fn stop_tree(pid: u32) -> Result<(), String> {
    let procs = processes();
    procs.get(&pid).ok_or("process is not running")?;
    let tree = descendants(pid, &procs);
    if tree.contains(&std::process::id()) {
        return Err("refusing to stop Soloyard itself".into());
    }
    for &p in &tree {
        unsafe { libc::kill(p as i32, libc::SIGTERM) };
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while tree.iter().any(|&p| alive(p)) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    for &p in tree.iter().filter(|&&p| alive(p)) {
        unsafe { libc::kill(p as i32, libc::SIGKILL) };
    }
    Ok(())
}

#[tauri::command(async)]
pub fn soloyard_service_stop(pid: u32) -> Result<(), String> {
    stop_tree(pid)
}

fn services_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("soloyard-services"))
}

#[derive(Serialize, Deserialize)]
struct Launch {
    cwd: String,
    command: String,
}

/// 日志 `<hash>.log` 旁边的 `<hash>.json` 记着启动时的目录和命令。
fn read_launch(log: &Path) -> Option<Launch> {
    serde_json::from_str(&std::fs::read_to_string(log.with_extension("json")).ok()?).ok()
}

/// 在 cwd 用登录 shell 后台跑 command，输出写到 `soloyard-services/<hash>.log`，返回日志路径。
fn spawn_logged(app: &AppHandle, cwd: &str, command: &str) -> Result<String, String> {
    if command.trim().is_empty() || !Path::new(cwd).is_dir() {
        return Err(format!("invalid command or directory: {cwd}"));
    }
    let dir = services_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 同一目录 + 命令共用一个日志文件；不同 worktree 跑同一命令不会撞。
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&(cwd, command), &mut hasher);
    let path = dir.join(format!("{:016x}.log", std::hash::Hasher::finish(&hasher)));
    let launch = serde_json::to_string(&Launch { cwd: cwd.into(), command: command.into() }).map_err(|e| e.to_string())?;
    std::fs::write(path.with_extension("json"), launch).map_err(|e| e.to_string())?;
    // ponytail: 日志只在启动时清空，一直不重启会一直长；真成问题再加按大小轮转。
    let log = File::create(&path).map_err(|e| e.to_string())?;
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        // 自己一个进程组：应用退出不会带走它。
        .process_group(0)
        .spawn()
        .map_err(|e| format!("failed to start: {e}"))?;
    std::thread::spawn(move || child.wait());
    Ok(path.to_string_lossy().into_owned())
}

/// 启动（历史里的、手动加的）服务，返回日志路径，日志标签马上就能读。
#[tauri::command(async)]
pub fn soloyard_service_start(app: AppHandle, cwd: String, command: String) -> Result<String, String> {
    spawn_logged(&app, &cwd, &command)
}

/// 停掉后在原目录用原命令重启。命令由前端传（列表里给的那条：我们起的是原始命令，别的是 ps 还原的）。
// ponytail: ps 还原的命令丢了引号和环境变量，参数里带空格的会跑偏；我们起过一次之后就是原始命令了。
#[tauri::command(async)]
pub fn soloyard_service_restart(app: AppHandle, pid: u32, cwd: String, command: String) -> Result<String, String> {
    stop_tree(pid)?;
    spawn_logged(&app, &cwd, &command)
}

#[derive(Serialize)]
pub struct Script {
    /// package.json 所在目录。
    dir: String,
    name: String,
    /// 脚本内容（`vite --port 5173`），给用户认。
    script: String,
    /// 按锁文件选的包管理器拼出的命令（`pnpm run dev`）。
    command: String,
}

/// 工作区里各个 package.json 的 scripts：根目录往下三层，跳过 node_modules 和隐藏目录。
#[tauri::command(async)]
pub fn soloyard_package_scripts(cwd: String) -> Vec<Script> {
    const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "out"];
    let root = PathBuf::from(&cwd);
    let mut scripts = Vec::new();
    let mut dirs = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = dirs.pop() {
        if let Some(found) = std::fs::read_to_string(dir.join("package.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        {
            let runner = package_manager(&dir, &root);
            if let Some(map) = found.get("scripts").and_then(|v| v.as_object()) {
                for (name, script) in map {
                    scripts.push(Script {
                        dir: dir.to_string_lossy().into_owned(),
                        name: name.clone(),
                        script: script.as_str().unwrap_or_default().to_string(),
                        command: format!("{runner} run {name}"),
                    });
                }
            }
        }
        if depth == 3 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().is_ok_and(|t| t.is_dir()) && !name.starts_with('.') && !SKIP.contains(&name.as_str()) {
                dirs.push((entry.path(), depth + 1));
            }
        }
    }
    scripts.sort_by(|a, b| (a.dir.len(), &a.dir, &a.name).cmp(&(b.dir.len(), &b.dir, &b.name)));
    scripts
}

/// 从 package.json 所在目录往上找到工作区根，看哪个锁文件在。
fn package_manager(dir: &Path, root: &Path) -> &'static str {
    for ancestor in dir.ancestors() {
        for (lock, runner) in [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lockb", "bun"), ("bun.lock", "bun")] {
            if ancestor.join(lock).exists() {
                return runner;
            }
        }
        if ancestor == root {
            break;
        }
    }
    "npm"
}

#[derive(Serialize)]
pub struct LogChunk {
    data: String,
    offset: u64,
}

/// 从 offset 读到文件末尾；第一次（offset 为 0）只读最后 256 KB。文件变短了（被清空）从头读。
#[tauri::command(async)]
pub fn soloyard_service_log(path: String, offset: u64) -> Result<LogChunk, String> {
    const TAIL: u64 = 256 * 1024;
    let mut file = File::open(Path::new(&path)).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = if offset == 0 || offset > len { len.saturating_sub(TAIL) } else { offset };
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(len - start).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(LogChunk { data: String::from_utf8_lossy(&bytes).into_owned(), offset: len })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(ppid: u32, args: &str) -> Proc {
        Proc { ppid, elapsed: 0, args: args.into() }
    }

    #[test]
    fn etime() {
        assert_eq!(parse_etime("05:03"), 303);
        assert_eq!(parse_etime("02:00:01"), 7201);
        assert_eq!(parse_etime("1-00:00:10"), 86410);
    }

    #[test]
    fn launch_walks_through_package_managers_and_stops_at_agent_shells() {
        let procs = HashMap::from([
            (100, proc(1, "claude")),
            (200, proc(100, "/bin/zsh -c source snapshot.sh && eval 'npm run dev'")),
            (300, proc(200, "npm run dev")),
            (400, proc(300, "sh -c vite")),
            (500, proc(400, "node /repo/node_modules/.bin/vite")),
            // 终端里的交互 shell
            (600, proc(1, "/Applications/Warp.app/Contents/MacOS/stable")),
            (700, proc(600, "-zsh")),
            (800, proc(700, "node server.js")),
        ]);
        let all = |_| true;
        assert_eq!(launch_pid(500, &procs, &all), 300);
        assert_eq!(launch_pid(800, &procs, &all), 800);
        // 出了工作区就停
        assert_eq!(launch_pid(500, &procs, &|pid| pid != 300), 500);
        assert_eq!(descendants(300, &procs).len(), 3);
    }

    #[test]
    fn package_scripts_pick_runner_and_skip_node_modules() {
        let root = std::env::temp_dir().join(format!("soloyard-scripts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("apps/web")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("pnpm-lock.yaml"), "").unwrap();
        std::fs::write(root.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        std::fs::write(root.join("apps/web/package.json"), r#"{"scripts":{"start":"next start"}}"#).unwrap();
        std::fs::write(root.join("node_modules/x/package.json"), r#"{"scripts":{"nope":"x"}}"#).unwrap();
        let scripts = soloyard_package_scripts(root.to_string_lossy().into_owned());
        let _ = std::fs::remove_dir_all(&root);
        let got: Vec<_> = scripts.iter().map(|s| (s.name.as_str(), s.command.as_str())).collect();
        assert_eq!(got, [("dev", "pnpm run dev"), ("start", "pnpm run start")]);
    }
}
