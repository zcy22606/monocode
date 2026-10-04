import { describe, expect, it } from "vitest";
import { newEditorWorkspaceTab } from "../../workspace/model/layout";
import { parseWorkspaceSnapshot } from "../../workspace/model/workspaceSnapshot";
import { projectViewFile, sanitizeProjectView } from "./projectViews";

describe("project view tabs", () => {
  it("survive a workspace snapshot round trip (restart restores them as project views, not files)", () => {
    const file = projectViewFile({ cwd: "/p/app", view: "issue", itemId: "5", title: "SOL-5 会话关联：a/b" });
    const tab = newEditorWorkspaceTab(file);
    const saved = JSON.parse(JSON.stringify({ tabs: [tab], sessions: [], activeTabId: tab.id, projectCwd: "/p/app" }));
    const restored = parseWorkspaceSnapshot(saved)!.tabs[0].editorPanes[0].files[0];
    expect(restored.projectView).toEqual({ view: "issue", itemId: "5" });
    expect(restored.path).toBe("SOL-5 会话关联：a∕b");
  });

  it("drops unknown or malformed project view data", () => {
    expect(sanitizeProjectView({ view: "nope" })).toBeUndefined();
    expect(sanitizeProjectView("issues")).toBeUndefined();
    expect(sanitizeProjectView({ view: "issues", itemId: 3 })).toEqual({ view: "issues" });
  });
});
