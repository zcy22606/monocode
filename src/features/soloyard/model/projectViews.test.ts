import { describe, expect, it } from "vitest";
import { newEditorWorkspaceTab, type FilePaneTab } from "../../workspace/model/layout";
import { parseWorkspaceSnapshot } from "../../workspace/model/workspaceSnapshot";

// 项目视图现在开在右侧面板（SOL-66），以前开成标签的还在用户保存的布局里，重启时要关掉
describe("project view tabs saved before the side panel", () => {
  const view: FilePaneTab = { id: "v1", path: "SOL-5 会话关联", cwd: "/p/app", projectView: { view: "issue", itemId: "5" } };
  const file: FilePaneTab = { id: "f1", path: "README.md", cwd: "/p/app" };
  const restore = (tabs: ReturnType<typeof newEditorWorkspaceTab>[]) =>
    parseWorkspaceSnapshot(JSON.parse(JSON.stringify({ tabs, sessions: [], activeTabId: tabs[0].id, projectCwd: "/p/app" })))!;

  it("close on restore", () => {
    const restored = restore([newEditorWorkspaceTab(view), newEditorWorkspaceTab(file)]);
    expect(restored.tabs.map((tab) => tab.editorPanes[0].files.map((f) => f.id))).toEqual([["f1"]]);
    expect(restored.activeTabId).toBe(restored.tabs[0].id);
  });
});
