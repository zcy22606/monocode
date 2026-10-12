//! Soloyard：头脑风暴在侧栏里当成一个项目——根目录是应用数据目录下的 workspace/，
//! 每个头脑风暴是它下面的一个子文件夹。列这个「项目」的会话时，把各子文件夹里的会话都收进来，
//! 这样搜索、筛选、归档、置顶都和普通项目一样。

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::session_store::SessionSummary;

/// 头脑风暴的根目录（应用数据目录下的 workspace/）。
fn workspace_root(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("workspace"))
}

fn same_path(a: &str, b: &std::path::Path) -> bool {
    a.trim_end_matches('/') == b.to_string_lossy().trim_end_matches('/')
}

/// cwd 是头脑风暴根目录时，补上各子文件夹里的会话，按更新时间排。
pub fn extend_rows(app: &AppHandle, conn: &Connection, cwd: &str, rows: &mut Vec<SessionSummary>) {
    let Some(root) = workspace_root(app) else { return };
    if !same_path(cwd, &root) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&root) else { return };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let folder = entry.path().to_string_lossy().to_string();
        match crate::session_store::list_by_project(conn, &folder) {
            Ok(found) => rows.extend(found),
            Err(error) => eprintln!("brainstorm sessions in {folder}: {error}"),
        }
    }
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}
