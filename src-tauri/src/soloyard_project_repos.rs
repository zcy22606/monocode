//! Soloyard：多仓库项目。项目根目录下 / 别处挂着成员仓库（soloyard_project_repos，由数据层维护）。
//! 在成员仓库里干活的会话，cwd 记成项目根目录、worktree_cwd 记成实际的仓库（或它的工作树）——
//! 底座按 cwd 归项目，这样侧栏、会话列表都把它们放在根项目下，不用改上游的筛选。
//! 列根项目的会话时：导入成员仓库里的终端历史，把 cwd 还是成员仓库的会话（以前单开的、刚导入的）收过来，
//! 再给卡片标上所在仓库的名字。

use std::path::Path;

use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter};

use crate::session_store::SessionSummary;

/// 同一个仓库里并发 `git branch -m` 会抢 `.git/logs/refs/.tmp-renamed-log` 而失败（实测 5 个里坏好几个）；
/// 并行开工会一次建好几个工作树、各自改名。建工作树和改名都在这把锁里排队。
/// ponytail: 全局一把锁，不分仓库；建工作树很快，真慢了再按仓库分锁。
pub fn ref_write_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 以 `cwd` 为根目录的项目的成员仓库（不含根目录本身）。数据层还没建表时为空。
fn members(conn: &Connection, cwd: &str) -> Vec<String> {
    let cwd = cwd.trim_end_matches('/');
    conn.prepare(
        "SELECT r.path FROM soloyard_project_repos r
         JOIN soloyard_project_paths p ON p.project_id = r.project_id
         WHERE rtrim(p.path, '/') = ?1 AND r.path <> ?1 ORDER BY r.sort, r.id",
    )
    .and_then(|mut stmt| {
        stmt.query_map([cwd], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap_or_default()
}

/// 列根项目会话前调用：导入根目录、成员仓库、它们的工作树以及这些目录下子目录里的终端历史，
/// 再把 cwd 还是成员仓库的会话（以前单独开的）收到根项目下。
pub fn adopt_members(app: &AppHandle, conn: &Connection, cwd: &str) {
    let root = cwd.trim_end_matches('/');
    let members = members(conn, root);
    if members.is_empty() {
        return;
    }
    let mut scopes = vec![root.to_string()];
    for member in &members {
        scopes.push(member.clone());
        scopes.extend(worktrees_of(member));
    }
    crate::history_import::import_tree(app, conn, root, &scopes);
    let mut adopted = Vec::new();
    for member in members {
        match adopt(conn, root, &member) {
            Ok(ids) => adopted.extend(ids),
            Err(error) => eprintln!("adopting sessions of {member} failed: {error}"),
        }
    }
    if !adopted.is_empty() {
        // 前端已载入的这些会话换成库里的新 cwd / 工作目录（同导入终端历史后的刷新）
        let _ = app.emit("soloyard:sessions-imported", &adopted);
    }
}

/// 仓库的工作树目录：.git/worktrees/<名字>/gitdir 指向工作树里的 .git 文件。
fn worktrees_of(repo: &str) -> Vec<String> {
    std::fs::read_dir(Path::new(repo).join(".git/worktrees"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| std::fs::read_to_string(entry.path().join("gitdir")).ok())
        .filter_map(|gitdir| Path::new(gitdir.trim()).parent().map(|p| p.to_string_lossy().into_owned()))
        .collect()
}

fn adopt(conn: &Connection, root: &str, member: &str) -> rusqlite::Result<Vec<String>> {
    let ids = conn
        .prepare("SELECT id FROM sessions WHERE cwd = ?1")?
        .query_map([member], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if ids.is_empty() {
        return Ok(ids);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE sessions SET worktree_cwd = COALESCE(NULLIF(worktree_cwd, ''), cwd), cwd = ?2 WHERE cwd = ?1",
        params![member, root],
    )?;
    tx.execute("UPDATE in_flight_sessions SET cwd = ?2 WHERE cwd = ?1", params![member, root])?;
    tx.commit()?;
    Ok(ids)
}

/// 会话卡片标上所在的仓库（底座只知道根目录，根目录又常常不是 git 仓库）。
pub fn label_rows(conn: &Connection, cwd: &str, rows: &mut [SessionSummary]) {
    let members = members(conn, cwd);
    if members.is_empty() {
        return;
    }
    for row in rows.iter_mut() {
        let Some(work) = row.worktree_cwd.as_deref().filter(|w| !w.is_empty()) else { continue };
        if let Some(member) = member_of(&members, work) {
            row.repo = Path::new(member).file_name().map(|name| name.to_string_lossy().into_owned());
        }
    }
}

/// 工作目录属于哪个成员仓库：仓库本身或子目录，或者它的工作树（工作树的 .git 文件指回 <仓库>/.git/worktrees/…）。
fn member_of<'a>(members: &'a [String], work: &str) -> Option<&'a str> {
    let inside = |path: &str, root: &str| path == root || path.starts_with(&format!("{root}/"));
    if let Some(member) = members.iter().find(|m| inside(work, m)) {
        return Some(member);
    }
    let link = std::fs::read_to_string(Path::new(work).join(".git")).ok()?;
    let gitdir = link.trim().strip_prefix("gitdir:")?.trim();
    let repo = &gitdir[..gitdir.find("/.git/worktrees/")?];
    members.iter().find(|m| m.as_str() == repo).map(String::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    #[test]
    fn adopts_member_sessions_and_labels_their_repo() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let tmp = std::env::temp_dir().join(format!("soloyard-repos-{}", uuid::Uuid::new_v4()));
        let (root, backend, wt) = (tmp.join("ws"), tmp.join("ws/backend"), tmp.join("wt-rotate"));
        std::fs::create_dir_all(&backend).unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}/.git/worktrees/wt-rotate\n", backend.display())).unwrap();
        let (root, backend, wt) = (root.to_string_lossy().into_owned(), backend.to_string_lossy().into_owned(), wt.to_string_lossy().into_owned());
        conn.execute_batch(
            "CREATE TABLE soloyard_project_paths (project_id INTEGER, path TEXT, recursive INTEGER DEFAULT 1);
             CREATE TABLE soloyard_project_repos (id INTEGER PRIMARY KEY, project_id INTEGER, path TEXT, description TEXT DEFAULT '', sort INTEGER DEFAULT 0);",
        )
        .unwrap();
        conn.execute("INSERT INTO soloyard_project_paths VALUES (1, ?1, 1)", [&root]).unwrap();
        conn.execute("INSERT INTO soloyard_project_repos (project_id, path) VALUES (1, ?1)", [&backend]).unwrap();
        assert_eq!(members(&conn, &format!("{root}/")), vec![backend.clone()]);
        assert!(members(&conn, &backend).is_empty(), "a member is not a root");

        for (id, cwd, worktree) in [("old", &backend, None), ("wt", &backend, Some(&wt)), ("other", &"/x".to_string(), None)] {
            conn.execute(
                "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at, worktree_cwd)
                 VALUES (?1, ?2, 'claude', 'm', 'auto', 't', '[]', 0, 0, ?3)",
                params![id, cwd, worktree],
            )
            .unwrap();
        }
        assert_eq!(adopt(&conn, &root, &backend).unwrap(), vec!["old".to_string(), "wt".to_string()]);
        let place = |id: &str| -> (String, Option<String>) {
            conn.query_row("SELECT cwd, worktree_cwd FROM sessions WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(place("old"), (root.clone(), Some(backend.clone())));
        assert_eq!(place("wt"), (root.clone(), Some(wt.clone())), "an existing worktree stays the working copy");
        assert_eq!(place("other").0, "/x");

        let members = members(&conn, &root);
        assert_eq!(member_of(&members, &format!("{backend}/src")), Some(backend.as_str()));
        assert_eq!(member_of(&members, &wt), Some(backend.as_str()), "a worktree belongs to its repo");
        assert_eq!(member_of(&members, &root), None);
        std::fs::remove_dir_all(&tmp).ok();
    }
}

