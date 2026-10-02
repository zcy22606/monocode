//! IndieDesk: native UI text (app menu, Dock menu, tray, notification buttons)
//! in the language the frontend picked (`src/i18n`).
//!
//! The English text is the key, so upstream call sites only change from
//! `"Settings…"` to `tr("Settings…")`. Unknown text falls back to English.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static ZH: AtomicBool = AtomicBool::new(false);

pub fn tr(en: &'static str) -> &'static str {
    if !ZH.load(Ordering::Relaxed) {
        return en;
    }
    zh(en).unwrap_or(en)
}

fn zh(en: &str) -> Option<&'static str> {
    Some(match en {
        // App menu
        "MonoCode" => "MonoCode",
        "About MonoCode" => "关于 MonoCode",
        "Settings…" => "设置…",
        "Check for Updates…" => "检查更新…",
        "Hide MonoCode" => "隐藏 MonoCode",
        "Hide Others" => "隐藏其他",
        "Show All" => "全部显示",
        "Quit MonoCode" => "退出 MonoCode",
        // File
        "File" => "文件",
        "New Window" => "新建窗口",
        "Open Project…" => "打开项目…",
        "Go to File…" => "前往文件…",
        "Command Palette…" => "命令面板…",
        "Search…" => "搜索…",
        "Find in Files…" => "在文件中查找…",
        "Autosave" => "自动保存",
        "New Tab" => "新建标签页",
        "New Terminal" => "新建终端",
        "New Terminal Tab" => "新建终端标签页",
        "Split Pane Right" => "向右拆分窗格",
        "Split Pane Down" => "向下拆分窗格",
        "Close Pane" => "关闭窗格",
        "Close Other Tabs" => "关闭其他标签页",
        "Close All Tabs" => "关闭所有标签页",
        "Previous Tab" => "上一个标签页",
        "Next Tab" => "下一个标签页",
        "Go Back" => "后退",
        "Go Forward" => "前进",
        // Edit
        "Edit" => "编辑",
        "Undo" => "撤销",
        "Redo" => "重做",
        "Cut" => "剪切",
        "Copy" => "拷贝",
        "Paste" => "粘贴",
        "Select All" => "全选",
        "Find" => "查找",
        // View
        "View" => "显示",
        "Toggle Sidebar" => "切换侧栏",
        "Toggle Session Sidebar" => "切换会话侧栏",
        "Inbox" => "收件箱",
        "Notes" => "笔记",
        "Toggle Terminal" => "切换终端",
        "Switch Model…" => "切换模型…",
        "Focus Pane Left" => "聚焦左侧窗格",
        "Focus Pane Right" => "聚焦右侧窗格",
        "Focus Pane Up" => "聚焦上方窗格",
        "Focus Pane Down" => "聚焦下方窗格",
        "Zoom In" => "放大",
        "Zoom Out" => "缩小",
        "Reset Zoom" => "实际大小",
        "Reload" => "重新载入",
        "Sidebar Appearance…" => "侧栏外观…",
        // Window / Help
        "Window" => "窗口",
        "Minimize" => "最小化",
        "Zoom" => "缩放",
        "Help" => "帮助",
        "MonoCode Website" => "MonoCode 官网",
        "View on GitHub" => "在 GitHub 上查看",
        "Report a Bug…" => "报告问题…",
        "Request a Feature…" => "功能建议…",
        // Tray / notifications
        "Show MonoCode" => "显示 MonoCode",
        "Show" => "显示",
        _ => return None,
    })
}

/// Called by every window on start and whenever the language changes.
#[tauri::command]
pub fn i18n_set_language(app: AppHandle, language: String) {
    let zh = language.starts_with("zh");
    if ZH.swap(zh, Ordering::Relaxed) == zh {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        crate::menu::rebuild(&app);
        crate::macos::install_dock_menu(&app);
        crate::notifications::install_delegate(&app);
    }
    #[cfg(target_os = "windows")]
    crate::tray::rebuild_menu(&app);
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_known_text_and_falls_back_to_english() {
        ZH.store(true, Ordering::Relaxed);
        assert_eq!(tr("Settings…"), "设置…");
        assert_eq!(tr("Not in the table"), "Not in the table");
        ZH.store(false, Ordering::Relaxed);
        assert_eq!(tr("Settings…"), "Settings…");
    }
}
