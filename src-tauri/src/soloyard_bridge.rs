//! Soloyard：界面和数据层（`soloyard/core`，Node）之间的桥。
//!
//! 第一次调用时拉起 `node soloyard/core/src/sidecar.ts <monocode.db>`，之后常驻；stdin / stdout 一行一个 JSON，
//! 按 id 配对回应。数据进程广播 `{"event":"changed"}` 时转发成前端事件 `soloyard:changed`。进程挂了下次调用自动重启。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/**
 * Soloyard 脚本（数据进程、MCP 服务）的位置：开发版跑仓库里的源码；正式版跑打包时复制进应用的那份
 * （tauri.conf.json 的 bundle.resources），这样改着的代码和数据库迁移碰不到日常用的正式版数据。
 * Node 两边都用登录 shell 里的。
 */
pub fn soloyard_script(app: &AppHandle, rel: &str) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../soloyard")).join(rel));
    }
    Ok(app.path().resource_dir().map_err(|e| e.to_string())?.join("soloyard").join(rel))
}

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
}

type Reply = Result<Value, String>;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static SIDECAR: Mutex<Option<Sidecar>> = Mutex::new(None);
static PENDING: LazyLock<Mutex<HashMap<u64, Sender<Reply>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn start(app: &AppHandle) -> Result<Sidecar, String> {
    let db = app.path().app_data_dir().map_err(|e| e.to_string())?.join("monocode.db");
    // 从程序坞启动的应用拿不到终端的 PATH（nvm 等），经登录 shell 找 node。
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(r#"exec node --no-warnings "$0" "$1""#)
        .arg(soloyard_script(app, "core/src/sidecar.ts")?)
        .arg(&db)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to start Soloyard data process: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            if msg.get("event").and_then(Value::as_str) == Some("changed") {
                let _ = app.emit("soloyard:changed", ());
                continue;
            }
            let Some(id) = msg.get("id").and_then(Value::as_u64) else { continue };
            let Some(tx) = PENDING.lock().ok().and_then(|mut p| p.remove(&id)) else { continue };
            let reply = match msg.get("error") {
                // 版本冲突带上最新的行，前端据此重新决定；其他错误只给文字。
                Some(error) => Err(match msg.get("latest") {
                    Some(latest) => json!({ "message": error, "latest": latest }).to_string(),
                    None => error.as_str().unwrap_or("error").to_string(),
                }),
                None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = tx.send(reply);
        }
        // 进程退出：还在等的请求都失败，下次调用会重启进程。
        if let Ok(mut pending) = PENDING.lock() {
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err("Soloyard data process exited".into()));
            }
        }
    });
    Ok(Sidecar { child, stdin })
}

#[tauri::command(async)]
pub fn soloyard_call(app: AppHandle, method: String, args: Value) -> Result<Value, String> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    PENDING.lock().map_err(|_| "Soloyard bridge is locked")?.insert(id, tx);
    let sent = (|| -> Result<(), String> {
        let mut guard = SIDECAR.lock().map_err(|_| "Soloyard bridge is locked")?;
        let alive = guard.as_mut().is_some_and(|s| matches!(s.child.try_wait(), Ok(None)));
        if !alive {
            *guard = Some(start(&app)?);
        }
        let sidecar = guard.as_mut().ok_or("Soloyard data process unavailable")?;
        let line = json!({ "id": id, "method": method, "args": args }).to_string();
        writeln!(sidecar.stdin, "{line}").map_err(|e| {
            *guard = None;
            e.to_string()
        })
    })();
    if let Err(error) = sent {
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&id);
        }
        return Err(error);
    }
    rx.recv_timeout(Duration::from_secs(30)).unwrap_or_else(|_| {
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&id);
        }
        Err("Soloyard data process timed out".into())
    })
}
