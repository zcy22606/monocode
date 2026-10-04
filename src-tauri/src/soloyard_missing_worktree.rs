//! Soloyard：工作树在应用外被删掉（`git worktree remove`、`rm -rf`）后，会话还指着不存在的目录，
//! 点开发不了消息。读会话时发现工作树目录没了，就按应用内「删除工作树」的方式把会话摘下来
//! （同 worktrees.rs 的 prepare_removal），输入框会让用户重新选分支 / 工作树继续。

use std::path::Path;

use rusqlite::{params, Connection};

/// 列项目会话前调用。
pub fn detach_for_project(conn: &Connection, cwd: &str) {
    detach(conn, "cwd", cwd);
}

/// 打开单个会话前调用。
pub fn detach_for_session(conn: &Connection, id: &str) {
    detach(conn, "id", id);
}

fn detach(conn: &Connection, column: &str, value: &str) {
    if let Err(error) = try_detach(conn, column, value) {
        eprintln!("missing worktree check failed for {value}: {error}");
    }
}

fn try_detach(conn: &Connection, column: &str, value: &str) -> rusqlite::Result<()> {
    let rows = conn
        .prepare(&format!(
            "SELECT id, worktree_cwd FROM sessions
             WHERE {column} = ?1 AND worktree_removed = 0 AND COALESCE(worktree_cwd, '') <> ''"
        ))?
        .query_map([value], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, worktree) in rows {
        if !is_gone(&crate::fs::expand_home(&worktree)) {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE sessions SET worktree_removed = 1, branch = NULL, provider_session_id = NULL,
               context_used = NULL, context_window = NULL WHERE id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM in_flight_sessions WHERE session_id = ?1", params![id])?;
        tx.commit()?;
    }
    Ok(())
}

/// 上一级目录还在、工作树目录没了才算删掉；整块盘没挂上时不动会话。
fn is_gone(path: &Path) -> bool {
    !path.to_string_lossy().starts_with("remote://")
        && !path.exists()
        && path.parent().is_some_and(Path::exists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    #[test]
    fn detaches_sessions_whose_worktree_was_deleted_outside_the_app() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let root = std::env::temp_dir().join(format!("soloyard-wt-{}", uuid::Uuid::new_v4()));
        let alive = root.join("alive");
        std::fs::create_dir_all(&alive).unwrap();
        let gone = root.join("gone");
        for (id, worktree) in [("s-gone", &gone), ("s-alive", &alive)] {
            conn.execute(
                "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json,
                   created_at, updated_at, worktree_cwd, branch, provider_session_id)
                 VALUES (?1, '/proj', 'claude', 'm', 'auto', 't', '[]', 0, 0, ?2, 'b', 'p')",
                params![id, worktree.to_string_lossy()],
            )
            .unwrap();
        }
        detach_for_project(&conn, "/proj");
        let state = |id: &str| -> (i64, Option<String>) {
            conn.query_row(
                "SELECT worktree_removed, provider_session_id FROM sessions WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(state("s-gone"), (1, None));
        assert_eq!(state("s-alive"), (0, Some("p".into())));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
