//! Soloyard：设置里把 Claude Code / Codex 接入 Soloyard MCP，并清掉原型 indie-desk 留下的 MCP、技能软链和钩子。
//!
//! 是否已接入由前端用底座的 `mcp_discover` 读配置判断；增删 MCP 一律走各家官方 CLI（底座 harness 里的辅助函数）。
//! 原型的技能和钩子由 MCP 服务自带的 instructions 取代，这里只清不装。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::harness::{add_mcp_via_cli, mcp_command, resolve_mcp_binary, HarnessHost};

/// 正式版注册成 `soloyard`、读写正式版的库；开发版注册成 `soloyard-dev`、读写开发版自己的库，两边互不覆盖。
const MCP_NAME: &str = if cfg!(debug_assertions) { "soloyard-dev" } else { "soloyard" };
const LEGACY_HOOK: &str = "indie-desk/packages/mcp/src/hook.ts";
const PROVIDERS: [&str; 2] = ["claude", "codex"];

fn home() -> Result<PathBuf, String> {
    crate::dirs_home()
        .map(PathBuf::from)
        .ok_or_else(|| "Home directory not found".into())
}

fn legacy_skills(home: &Path) -> [PathBuf; 2] {
    [
        home.join(".claude/skills/indie-desk"),
        home.join(".agents/skills/indie-desk"),
    ]
}

fn hook_files(home: &Path) -> [PathBuf; 2] {
    let codex = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    [home.join(".claude/settings.json"), codex.join("hooks.json")]
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// 去掉指向原型钩子脚本的 hook；被它清空的分组和事件一起删，别的不动。返回是否有改动。
fn strip_legacy_hooks(config: &mut Value) -> bool {
    let Some(events) = config.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    events.retain(|_, groups| {
        let Some(groups) = groups.as_array_mut() else {
            return true;
        };
        let before = groups.len();
        groups.retain_mut(|group| {
            let Some(hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            let n = hooks.len();
            hooks.retain(|hook| {
                !hook
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|command| command.contains(LEGACY_HOOK))
            });
            changed |= hooks.len() != n;
            hooks.len() == n || !hooks.is_empty()
        });
        groups.len() == before || !groups.is_empty()
    });
    changed
}

fn legacy_files(home: &Path) -> Vec<String> {
    let skills = legacy_skills(home).into_iter().filter(|p| p.is_symlink());
    let hooks = hook_files(home)
        .into_iter()
        .filter(|p| read_json(p).is_some_and(|mut config| strip_legacy_hooks(&mut config)));
    skills
        .chain(hooks)
        .map(|p| p.display().to_string())
        .collect()
}

/// 从程序坞启动的应用拿不到终端的 PATH（nvm 等），经登录 shell 找 node，写进 MCP 配置的是绝对路径。
fn node() -> Result<String, String> {
    let output = Command::new("/bin/zsh")
        .args(["-lc", "command -v node"])
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    match stdout.lines().last().map(str::trim) {
        Some(path) if output.status.success() && path.starts_with('/') => Ok(path.to_owned()),
        _ => Err("node not found on the login shell PATH".into()),
    }
}

fn server(app: &AppHandle) -> Result<String, String> {
    let path = crate::soloyard_bridge::soloyard_script(app, "mcp/server.ts")?;
    std::fs::canonicalize(&path)
        .map(|p| p.display().to_string())
        .map_err(|e| format!("{}: {e}", path.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoloyardAgents {
    /// 这个版本注册用的 MCP 名字（正式版 soloyard / 开发版 soloyard-dev）
    name: &'static str,
    server: String,
    /// 找得到 CLI 的 provider（claude / codex）
    installed: Vec<&'static str>,
    /// 还在的原型技能软链、含原型钩子的配置文件
    legacy_files: Vec<String>,
}

#[tauri::command(async)]
pub fn soloyard_agents_status(app: AppHandle, host: State<'_, HarnessHost>) -> Result<SoloyardAgents, String> {
    let installed = PROVIDERS
        .into_iter()
        .filter(|p| resolve_mcp_binary(p, host.runtime_binary_path(p).as_deref()).is_ok())
        .collect();
    Ok(SoloyardAgents {
        name: MCP_NAME,
        server: server(&app)?,
        installed,
        legacy_files: legacy_files(&home()?),
    })
}

#[tauri::command(async)]
pub fn soloyard_mcp_connect(app: AppHandle, host: State<'_, HarnessHost>, provider: String) -> Result<(), String> {
    let server = server(&app)?;
    // 开发版的 MCP 指向开发版自己的库；正式版用 server.ts 的默认库（正式版数据目录）
    let db = cfg!(debug_assertions)
        .then(|| app.path().app_data_dir().map(|d| d.join("monocode.db").display().to_string()))
        .transpose()
        .map_err(|e| e.to_string())?;
    connect(&provider, &server, db.as_deref(), host.runtime_binary_path(&provider).as_deref())
}

/// 删用户级的 soloyard 或原型的 indie-desk。
#[tauri::command(async)]
pub fn soloyard_mcp_remove(
    host: State<'_, HarnessHost>,
    provider: String,
    name: String,
) -> Result<(), String> {
    remove(
        &provider,
        &name,
        host.runtime_binary_path(&provider).as_deref(),
    )
}

fn connect(provider: &str, server: &str, db: Option<&str>, binary: Option<&str>) -> Result<(), String> {
    let actor = match provider {
        "claude" => "agent:claude-code",
        "codex" => "agent:codex",
        _ => return Err("Unsupported MCP provider".into()),
    };
    let mut env = json!({ "SOLOYARD_ACTOR": actor });
    if let Some(db) = db {
        env["SOLOYARD_DB"] = json!(db);
    }
    let config = json!({
        "type": "stdio",
        "command": node()?,
        "args": ["--no-warnings", server],
        "env": env,
    });
    let home = home()?.display().to_string();
    add_mcp_via_cli(provider, "user", &home, MCP_NAME, &config, binary)
}

fn remove(provider: &str, name: &str, binary: Option<&str>) -> Result<(), String> {
    if name != MCP_NAME && name != "indie-desk" {
        return Err("Unsupported MCP server".into());
    }
    let mut args = vec!["mcp".to_owned(), "remove".into(), name.into()];
    match provider {
        "claude" => args.extend(["--scope".into(), "user".into()]),
        "codex" => {}
        _ => return Err("Unsupported MCP provider".into()),
    }
    let binary = resolve_mcp_binary(provider, binary)?;
    mcp_command(
        binary,
        args,
        home()?.display().to_string(),
        Duration::from_secs(30),
    )
    .map(drop)
}

/// 删原型的技能软链（只删软链，不碰真目录），从钩子配置里摘掉原型钩子（先备份成 *.soloyard.bak）。
#[tauri::command(async)]
pub fn soloyard_legacy_cleanup() -> Result<(), String> {
    let home = home()?;
    for skill in legacy_skills(&home) {
        if skill.is_symlink() {
            std::fs::remove_file(&skill).map_err(|e| format!("{}: {e}", skill.display()))?;
        }
    }
    for file in hook_files(&home) {
        let Some(mut config) = read_json(&file) else {
            continue;
        };
        if !strip_legacy_hooks(&mut config) {
            continue;
        }
        let fail = |e: std::io::Error| format!("{}: {e}", file.display());
        std::fs::copy(&file, format!("{}.soloyard.bak", file.display())).map_err(fail)?;
        // ponytail: serde_json 没开 preserve_order，重写后键按字母序排（内容不变、有备份）；只在真有原型钩子时才写。
        let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        std::fs::write(&file, text + "\n").map_err(fail)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_only_the_prototype_hook() {
        let mut config = json!({
            "model": "opus",
            "hooks": {
                "SessionStart": [
                    { "hooks": [{ "type": "command", "command": "\"/bin/node\" \"/u/indie-desk/packages/mcp/src/hook.ts\"" }] },
                    { "hooks": [
                        { "type": "command", "command": "other.sh" },
                        { "type": "command", "command": "node /x/indie-desk/packages/mcp/src/hook.ts" }
                    ] },
                    { "hooks": [] }
                ],
                "Stop": [{ "hooks": [{ "type": "command", "command": "stop.sh" }] }]
            }
        });
        assert!(strip_legacy_hooks(&mut config));
        assert_eq!(
            config,
            json!({
                "model": "opus",
                "hooks": {
                    "SessionStart": [
                        { "hooks": [{ "type": "command", "command": "other.sh" }] },
                        { "hooks": [] }
                    ],
                    "Stop": [{ "hooks": [{ "type": "command", "command": "stop.sh" }] }]
                }
            })
        );
        assert!(!strip_legacy_hooks(&mut config));

        let mut only = json!({ "hooks": { "SessionStart": [{ "hooks": [{ "command": "n indie-desk/packages/mcp/src/hook.ts" }] }] } });
        assert!(strip_legacy_hooks(&mut only));
        assert_eq!(only, json!({ "hooks": {} }));
    }

    /// 真跑 claude / codex CLI，在临时 HOME 里接入、检测、断开、清理原型残留。
    /// `HOME=$(mktemp -d) CODEX_HOME=$HOME/.codex cargo test soloyard_agents -- --ignored`
    #[test]
    #[ignore]
    fn connects_and_cleans_up_in_a_sandbox_home() {
        let home = home().unwrap();
        assert!(
            !home.join(".claude.json").exists(),
            "run with a temporary HOME"
        );
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        // 和界面一样用底座的 mcp_discover 判断是否已接入
        let discover = || {
            let found = tauri::async_runtime::block_on(crate::mcp::mcp_discover(
                home.display().to_string(),
            ))
            .unwrap();
            serde_json::to_value(found)
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .filter(|c| c["scope"] == "user")
                .map(|c| {
                    format!(
                        "{}:{}",
                        c["provider"].as_str().unwrap(),
                        c["name"].as_str().unwrap()
                    )
                })
                .collect::<Vec<_>>()
        };
        let server = concat!(env!("CARGO_MANIFEST_DIR"), "/../soloyard/mcp/server.ts");
        for provider in PROVIDERS {
            connect(provider, server, Some("/tmp/soloyard-test.db"), None).unwrap();
        }
        assert_eq!(discover(), [format!("claude:{MCP_NAME}"), format!("codex:{MCP_NAME}")]);
        for provider in PROVIDERS {
            remove(provider, MCP_NAME, None).unwrap();
        }
        assert!(discover().is_empty());

        // 原型留下的：技能软链 + 两份钩子配置
        for skill in legacy_skills(&home) {
            std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink("/nonexistent/indie-desk", &skill).unwrap();
        }
        let hook = json!({ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /p/indie-desk/packages/mcp/src/hook.ts" }] }] } });
        for file in hook_files(&home) {
            std::fs::write(&file, hook.to_string()).unwrap();
        }
        assert_eq!(legacy_files(&home).len(), 4);
        soloyard_legacy_cleanup().unwrap();
        assert!(legacy_files(&home).is_empty());
        assert!(legacy_skills(&home).iter().all(|p| !p.is_symlink()));
        for file in hook_files(&home) {
            assert_eq!(read_json(&file).unwrap(), json!({ "hooks": {} }));
            assert!(Path::new(&format!("{}.soloyard.bak", file.display())).exists());
        }
    }
}
