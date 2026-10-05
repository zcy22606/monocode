//! Soloyard：把在终端里跑过的 Claude Code / Codex 会话导进项目侧栏。
//!
//! 打开项目（列会话）时按项目目录增量导入：只读 agent 的转录文件，转成文本 block 写进 sessions 表，
//! 带上 provider_session_id，点开后发消息就续接原会话。处理过的文件记在 history_files（按 mtime）。
//! 已经在 MonoCode 里开过的会话（同一个 provider_session_id）不重复导入。

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::session_store::{upsert_session, SessionUpsert};

const MAX_TEXT: usize = 20_000;

/// 列项目会话前调用；出错只记日志，不影响列表。
/// 开发版默认不导入：终端历史是同一批 Claude / Codex 会话，正式版已经导入，两边都能接着聊会冲突。
/// 要在开发版里测这个功能时设 `SOLOYARD_DEV_HISTORY_IMPORT=1`。
pub fn import_for_project(conn: &Connection, cwd: &str) {
    if cfg!(debug_assertions) && std::env::var_os("SOLOYARD_DEV_HISTORY_IMPORT").is_none() {
        return;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return };
    if let Err(error) = import_with_home(conn, &home, cwd) {
        eprintln!("history import failed for {cwd}: {error}");
    }
}

pub(crate) fn import_with_home(conn: &Connection, home: &Path, cwd: &str) -> Result<usize, String> {
    let cwd = cwd.trim_end_matches('/');
    if cwd.is_empty() || cwd == "~" || cwd.starts_with("remote://") {
        return Ok(0);
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history_files (
           path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, harness TEXT NOT NULL, cwd TEXT,
           done INTEGER NOT NULL DEFAULT 0, session_id TEXT, written_updated_at INTEGER)",
    )
    .map_err(|e| e.to_string())?;

    let mut candidates: Vec<(PathBuf, &str)> = Vec::new();
    // ponytail: Claude 对超长路径会截断加 hash，这里只按完整编码找目录；碰到再补
    let claude_dir = home.join(".claude/projects").join(claude_dir_name(cwd));
    for entry in fs::read_dir(&claude_dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "jsonl") {
            candidates.push((path, "claude"));
        }
    }
    walk_codex(&home.join(".codex/sessions"), 4, &mut candidates);
    let codex_titles = codex_titles(home);

    let mut imported = 0;
    for (path, harness) in candidates {
        let key = path.to_string_lossy().to_string();
        let Some(mtime) = mtime_millis(&path) else { continue };
        let row: Option<(i64, Option<String>, i64, Option<String>, Option<i64>)> = conn
            .query_row(
                "SELECT mtime, cwd, done, session_id, written_updated_at FROM history_files WHERE path = ?1",
                params![key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((m, row_cwd, done, _, _)) = &row {
            if *m == mtime && (row_cwd.as_deref() != Some(cwd) || *done == 1) {
                continue;
            }
        }
        // Codex 文件不按目录分，先只读第一行拿 cwd，不是这个项目的记下来下次跳过
        let file_cwd = if harness == "codex" { codex_cwd(&path) } else { None };
        if harness == "codex" && file_cwd.as_deref() != Some(cwd) {
            remember(conn, &key, mtime, harness, file_cwd.as_deref(), 0, row.as_ref().and_then(|r| r.3.clone()), None)?;
            continue;
        }
        let Some(parsed) = (if harness == "claude" { parse_claude(&path) } else { parse_codex(&path, &codex_titles) }) else {
            remember(conn, &key, mtime, harness, Some(cwd), 1, None, None)?;
            continue;
        };
        if parsed.cwd.as_deref() != Some(cwd) {
            remember(conn, &key, mtime, harness, parsed.cwd.as_deref(), 0, None, None)?;
            continue;
        }
        let prev_ours = row.as_ref().and_then(|r| r.3.clone());
        let existing: Option<(String, i64)> = conn
            .query_row(
                "SELECT id, updated_at FROM sessions WHERE harness = ?1 AND provider_session_id = ?2 ORDER BY updated_at DESC LIMIT 1",
                params![harness, parsed.provider_session_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let target = match (&existing, &prev_ours) {
            // 没导入过、MonoCode 里也没有：新建
            (None, _) => uuid::Uuid::new_v4().to_string(),
            // 我们导入的，且导入后没在 MonoCode 里续聊过：用终端里的新内容刷新
            (Some((id, updated)), Some(ours)) if id == ours && Some(*updated) == row.as_ref().and_then(|r| r.4) => id.clone(),
            // MonoCode 自己开的，或者导入后已经在 MonoCode 里接着聊了：以 MonoCode 的记录为准
            _ => {
                remember(conn, &key, mtime, harness, Some(cwd), 1, prev_ours, row.as_ref().and_then(|r| r.4))?;
                continue;
            }
        };
        let session = SessionUpsert {
            id: target.clone(),
            cwd: cwd.to_string(),
            harness: harness.to_string(),
            model: parsed.model,
            model_settings: json!({}),
            runtime_mode: "supervised".into(),
            title: parsed.title,
            provider_session_id: Some(parsed.provider_session_id),
            provider_account_id: None,
            blocks: Value::Array(parsed.blocks),
            context_used: None,
            context_window: None,
            branch: parsed.branch,
            worktree_cwd: None,
            worktree_removed: false,
            linked_work_item: None,
            automation_id: None,
        };
        upsert_session(conn, &session).map_err(|e| e.to_string())?;
        // upsert 用的是当前时间；改回转录里的时间，侧栏才按真实先后排
        conn.execute(
            "UPDATE sessions SET created_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![target, parsed.started_at, parsed.updated_at],
        )
        .map_err(|e| e.to_string())?;
        remember(conn, &key, mtime, harness, Some(cwd), 1, Some(target), Some(parsed.updated_at))?;
        imported += 1;
    }
    Ok(imported)
}

#[allow(clippy::too_many_arguments)]
fn remember(
    conn: &Connection,
    path: &str,
    mtime: i64,
    harness: &str,
    cwd: Option<&str>,
    done: i64,
    session_id: Option<String>,
    written_updated_at: Option<i64>,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO history_files (path, mtime, harness, cwd, done, session_id, written_updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![path, mtime, harness, cwd, done, session_id, written_updated_at],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Claude Code 的项目目录名：路径里每个不是 ASCII 字母数字的字符都换成 `-`。
fn claude_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn walk_codex(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, &'static str)>) {
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                walk_codex(&path, depth - 1, out);
            }
        } else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl")) {
            out.push((path, "codex"));
        }
    }
}

fn mtime_millis(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

fn codex_cwd(path: &Path) -> Option<String> {
    let mut line = String::new();
    BufReader::new(fs::File::open(path).ok()?).read_line(&mut line).ok()?;
    let value: Value = serde_json::from_str(&line).ok()?;
    if value["type"] != "session_meta" {
        return None;
    }
    value["payload"]["cwd"].as_str().map(|s| s.trim_end_matches('/').to_string())
}

/// Codex 的线程名（含 /rename）在 session_index.jsonl，后写的算。
fn codex_titles(home: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(file) = fs::File::open(home.join(".codex/session_index.jsonl")) else { return map };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if let (Some(id), Some(name)) = (v["id"].as_str(), v["thread_name"].as_str()) {
                map.insert(id.to_string(), name.to_string());
            }
        }
    }
    map
}

struct Parsed {
    provider_session_id: String,
    cwd: Option<String>,
    branch: Option<String>,
    title: String,
    model: String,
    blocks: Vec<Value>,
    started_at: i64,
    updated_at: i64,
}

/// 只取人和 agent 说的话：跳过工具调用、思考、agent 自动塞进对话的内容。
fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter(|c| matches!(c["type"].as_str(), Some("text" | "input_text" | "output_text")))
            .filter_map(|c| c["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn is_noise(text: &str) -> bool {
    let t = text.trim_start();
    t.is_empty()
        || t.starts_with("Caveat:")
        || t.starts_with("# AGENTS.md instructions")
        || t.strip_prefix('<').is_some_and(|rest| {
            // <command-name>、<environment_context> 这类 agent 自动注入的标签开头
            let tag: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
            !tag.is_empty() && rest[tag.len()..].starts_with(['>', ' ', '\n'])
        })
}

fn millis(ts: &str) -> Option<i64> {
    let t = time::OffsetDateTime::parse(ts, &time::format_description::well_known::Rfc3339).ok()?;
    Some((t.unix_timestamp_nanos() / 1_000_000) as i64)
}

/// 连续的 agent 文本合成一个 block（Claude 一轮回复会拆成多行记录）。
fn push_block(blocks: &mut Vec<Value>, role: &str, text: &str, at: Option<i64>) {
    let text: String = text.chars().take(MAX_TEXT).collect();
    if role == "assistant" {
        if let Some(last) = blocks.last_mut() {
            if last["role"] == "assistant" {
                let merged = format!("{}\n\n{}", last["text"].as_str().unwrap_or(""), text);
                last["text"] = Value::String(merged);
                return;
            }
        }
    }
    let mut block = json!({ "id": uuid::Uuid::new_v4().to_string(), "role": role, "text": text });
    if let (Some(at), "user") = (at, role) {
        block["startedAt"] = json!(at);
    }
    blocks.push(block);
}

fn first_line_title(blocks: &[Value]) -> Option<String> {
    let first = blocks.iter().find(|b| b["role"] == "user")?["text"].as_str()?;
    Some(first.lines().next().unwrap_or("").chars().take(80).collect())
}

fn parse_claude(path: &Path) -> Option<Parsed> {
    let file = fs::File::open(path).ok()?;
    let (mut psid, mut cwd, mut branch, mut model) = (None::<String>, None::<String>, None::<String>, None::<String>);
    let (mut custom, mut ai) = (None::<String>, None::<String>);
    let (mut started, mut updated) = (None::<i64>, None::<i64>);
    let mut blocks = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        // 转录的大头是工具输出和附件，先用字符串筛掉再解析 JSON（800MB 的项目首次导入快几倍）
        let wanted = line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"") || line.contains("-title\"") || line.contains("\"type\":\"summary\"");
        let tool_only = line.contains("\"type\":\"assistant\"") && !line.contains("\"type\":\"text\"");
        if !wanted || tool_only || line.contains("\"type\":\"tool_result\"") {
            continue;
        }
        let Ok(o) = serde_json::from_str::<Value>(&line) else { continue };
        let at = o["timestamp"].as_str().and_then(millis);
        if let Some(at) = at {
            started.get_or_insert(at);
            updated = Some(at);
        }
        if psid.is_none() {
            psid = o["sessionId"].as_str().map(str::to_string);
        }
        if cwd.is_none() {
            cwd = o["cwd"].as_str().map(|s| s.trim_end_matches('/').to_string());
        }
        if branch.is_none() {
            branch = o["gitBranch"].as_str().filter(|b| !b.is_empty() && *b != "HEAD").map(str::to_string);
        }
        match o["type"].as_str() {
            Some("custom-title") => custom = o["customTitle"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
            Some("ai-title") => ai = o["aiTitle"].as_str().map(str::to_string).or(ai),
            Some("summary") if ai.is_none() => ai = o["summary"].as_str().map(str::to_string),
            Some(role @ ("user" | "assistant")) if o["isSidechain"] != true && o["isMeta"] != true => {
                if role == "assistant" && model.is_none() {
                    model = o["message"]["model"].as_str().map(str::to_string);
                }
                let text = text_of(&o["message"]["content"]);
                if !is_noise(&text) {
                    push_block(&mut blocks, role, &text, at);
                }
            }
            _ => {}
        }
    }
    if blocks.iter().all(|b| b["role"] != "user") {
        return None;
    }
    let family = model.as_deref().and_then(|m| ["opus", "sonnet", "haiku"].into_iter().find(|f| m.contains(f))).unwrap_or("sonnet");
    let title = custom.or(ai).or_else(|| first_line_title(&blocks)).unwrap_or_else(|| "Untitled".into());
    Some(Parsed {
        provider_session_id: psid?,
        cwd,
        branch,
        title,
        model: format!("claude:{family}"),
        blocks,
        started_at: started.unwrap_or(0),
        updated_at: updated.unwrap_or(0),
    })
}

fn parse_codex(path: &Path, titles: &HashMap<String, String>) -> Option<Parsed> {
    let file = fs::File::open(path).ok()?;
    let (mut psid, mut cwd, mut branch, mut model) = (None::<String>, None::<String>, None::<String>, None::<String>);
    let (mut started, mut updated) = (None::<i64>, None::<i64>);
    let mut blocks = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let wanted = line.contains("\"type\":\"message\"") || line.contains("\"type\":\"session_meta\"") || line.contains("\"type\":\"turn_context\"");
        if !wanted {
            continue;
        }
        let Ok(o) = serde_json::from_str::<Value>(&line) else { continue };
        let at = o["timestamp"].as_str().and_then(millis);
        if let Some(at) = at {
            started.get_or_insert(at);
            updated = Some(at);
        }
        let p = &o["payload"];
        match o["type"].as_str() {
            Some("session_meta") => {
                psid = p["id"].as_str().map(str::to_string);
                cwd = p["cwd"].as_str().map(|s| s.trim_end_matches('/').to_string());
                branch = p["git"]["branch"].as_str().map(str::to_string);
            }
            Some("turn_context") if model.is_none() => model = p["model"].as_str().map(str::to_string),
            Some("response_item") if p["type"] == "message" => {
                if let Some(role @ ("user" | "assistant")) = p["role"].as_str() {
                    let text = text_of(&p["content"]);
                    if !is_noise(&text) {
                        push_block(&mut blocks, role, &text, at);
                    }
                }
            }
            _ => {}
        }
    }
    if blocks.iter().all(|b| b["role"] != "user") {
        return None;
    }
    let psid = psid?;
    let title = titles.get(&psid).cloned().or_else(|| first_line_title(&blocks)).unwrap_or_else(|| "Untitled".into());
    Some(Parsed {
        provider_session_id: psid,
        cwd,
        branch,
        title,
        model: format!("codex:{}", model.unwrap_or_else(|| "gpt-5-codex".into())),
        blocks,
        started_at: started.unwrap_or(0),
        updated_at: updated.unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, lines: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    }

    #[test]
    fn imports_terminal_sessions_once_and_skips_monocode_ones() {
        let home = std::env::temp_dir().join(format!("hist-{}", uuid::Uuid::new_v4()));
        let cwd = "/work/产品 app";
        let dir = home.join(".claude/projects").join(claude_dir_name(cwd));
        assert_eq!(claude_dir_name(cwd), "-work----app");
        let c1 = "11111111-1111-4111-8111-111111111111";
        write(&dir.join(format!("{c1}.jsonl")), &[
            json!({"type":"user","sessionId":c1,"cwd":cwd,"gitBranch":"main","timestamp":"2026-09-01T00:00:00Z","entrypoint":"cli","message":{"content":"<command-name>/clear</command-name>"}}),
            json!({"type":"user","sessionId":c1,"cwd":cwd,"timestamp":"2026-09-01T00:00:01Z","message":{"content":"修登录页"}}),
            json!({"type":"assistant","sessionId":c1,"cwd":cwd,"timestamp":"2026-09-01T00:00:02Z","message":{"model":"claude-opus-5-5","content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"好的"}]}}),
            json!({"type":"assistant","sessionId":c1,"cwd":cwd,"timestamp":"2026-09-01T00:00:03Z","message":{"content":[{"type":"text","text":"改完了"}]}}),
            json!({"type":"ai-title","sessionId":c1,"aiTitle":"自动标题"}),
            json!({"type":"custom-title","sessionId":c1,"customTitle":"登录页修复"}),
        ]);
        let x1 = "22222222-2222-4222-8222-222222222222";
        write(&home.join(".codex/sessions/2026/09/02/rollout-a.jsonl"), &[
            json!({"type":"session_meta","timestamp":"2026-09-02T00:00:00Z","payload":{"id":x1,"cwd":cwd}}),
            json!({"type":"turn_context","payload":{"model":"gpt-5.5"}}),
            json!({"type":"response_item","timestamp":"2026-09-02T00:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>x</environment_context>"}]}}),
            json!({"type":"response_item","timestamp":"2026-09-02T00:00:02Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"写接口"}]}}),
        ]);
        write(&home.join(".codex/sessions/2026/09/02/rollout-other.jsonl"), &[
            json!({"type":"session_meta","payload":{"id":"33333333-3333-4333-8333-333333333333","cwd":"/elsewhere"}}),
        ]);

        let conn = Connection::open_in_memory().unwrap();
        crate::session_store::migrate(&conn).unwrap();
        assert_eq!(import_with_home(&conn, &home, cwd).unwrap(), 2);
        assert_eq!(import_with_home(&conn, &home, cwd).unwrap(), 0, "unchanged files are skipped");

        let (title, model, blocks, updated): (String, String, String, i64) = conn
            .query_row("SELECT title, model, blocks_json, updated_at FROM sessions WHERE provider_session_id = ?1", params![c1], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!((title.as_str(), model.as_str()), ("登录页修复", "claude:opus"));
        let blocks: Vec<Value> = serde_json::from_str(&blocks).unwrap();
        assert_eq!(blocks.len(), 2, "noise dropped, assistant lines merged");
        assert_eq!(blocks[1]["text"], "好的\n\n改完了");
        assert_eq!(updated, millis("2026-09-01T00:00:03Z").unwrap());
        let codex_model: String = conn.query_row("SELECT model FROM sessions WHERE provider_session_id = ?1", params![x1], |r| r.get(0)).unwrap();
        assert_eq!(codex_model, "codex:gpt-5.5");

        // MonoCode 里已有的会话（同一个 provider_session_id）不重复导入
        let c2 = "44444444-4444-4444-8444-444444444444";
        conn.execute("INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, provider_session_id, created_at, updated_at) VALUES ('mono', ?1, 'claude', 'claude:sonnet', 'supervised', 'mine', ?2, 1, 1)", params![cwd, c2]).unwrap();
        write(&dir.join(format!("{c2}.jsonl")), &[json!({"type":"user","sessionId":c2,"cwd":cwd,"message":{"content":"hi"}})]);
        assert_eq!(import_with_home(&conn, &home, cwd).unwrap(), 0);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM sessions WHERE provider_session_id = ?1", params![c2], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        fs::remove_dir_all(&home).ok();
    }
}

#[cfg(test)]
mod bench {
    /// 手动跑：cargo test history_import::bench -- --ignored --nocapture（只读真实 HOME，写内存库）
    #[test]
    #[ignore]
    fn real_home_timing() {
        let home = std::path::PathBuf::from(std::env::var("HOME").unwrap());
        for cwd in ["/Users/zcy22606/Workspace/openroboto", "/Users/zcy22606/CodeResource/opc-marketing"] {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            crate::session_store::migrate(&conn).unwrap();
            let t = std::time::Instant::now();
            let n = super::import_with_home(&conn, &home, cwd).unwrap();
            let first = t.elapsed();
            let t = std::time::Instant::now();
            super::import_with_home(&conn, &home, cwd).unwrap();
            println!("{cwd}: imported {n} in {first:?}, second pass {:?}", t.elapsed());
        }
    }
}
