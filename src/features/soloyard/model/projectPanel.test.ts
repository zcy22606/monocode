// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  panelShownFor,
  backProjectPanel,
  clampFloatRect,
  openInProjectPanel,
  exitProjectPanelFull,
  resetProjectPanel,
  retargetProjectPanel,
  toggleProjectPanelFloat,
  toggleProjectPanelFull,
  selectProjectPanelView,
  toggleProjectPanel,
  popProjectPanelTo,
  type ProjectPanelState,
} from "./projectPanel";

// 每次改动都会存进 localStorage，直接读它就是当前状态
const read = (): ProjectPanelState => JSON.parse(localStorage.getItem("soloyard.projectPanel")!);
/** 栈的样子：列表 / 模块写视图名，详情写条目 id。 */
const path = () => read().stack.map((e) => e.itemId ?? e.view);

beforeEach(() => {
  localStorage.clear();
  resetProjectPanel();
});

describe("project panel", () => {
  it("the title-bar button opens the project home, then wherever it was left", () => {
    toggleProjectPanel("/p/a");
    expect(read()).toMatchObject({ open: true, cwd: "/p/a", stack: [{ view: "overview" }] });
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5 x" });
    toggleProjectPanel("/p/a");
    expect(read().open).toBe(false);
    // 同一项目：连详情一起回来
    toggleProjectPanel("/p/a");
    expect(path()).toEqual(["overview", "issues", "5"]);
    selectProjectPanelView("cycles");
    toggleProjectPanel("/p/a");
    // 别的项目：从主页开始
    toggleProjectPanel("/p/b");
    expect(read()).toMatchObject({ open: true, cwd: "/p/b", stack: [{ view: "overview" }] });
    expect(panelShownFor(read(), "/p/a")).toBe(false);
  });

  it("everything hangs under home: modules swap, details push, back pops, breadcrumbs jump", () => {
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5" });
    expect(path()).toEqual(["overview", "issues", "5"]);
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "6", title: "SOL-6" });
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "6", title: "SOL-6" });
    expect(path()).toEqual(["overview", "issues", "5", "6"]);
    backProjectPanel();
    expect(path()).toEqual(["overview", "issues", "5"]);
    // 面包屑点「Issues」回到列表，点「概览」回主页
    popProjectPanelTo(1);
    expect(path()).toEqual(["overview", "issues"]);
    popProjectPanelTo(0);
    expect(path()).toEqual(["overview"]);
    backProjectPanel();
    expect(path()).toEqual(["overview"]);
    // 模块下拉：平级换，不用先回主页
    openInProjectPanel({ cwd: "/p/a", view: "decision", itemId: "D-2", title: "D-2" });
    selectProjectPanelView("cycles");
    expect(path()).toEqual(["overview", "cycles"]);
    selectProjectPanelView("overview");
    expect(path()).toEqual(["overview"]);
    openInProjectPanel({ cwd: "/p/a", view: "docs", title: "Docs" });
    expect(path()).toEqual(["overview", "docs"]);
    openInProjectPanel({ cwd: "/p/a", view: "overview", title: "Overview" });
    expect(path()).toEqual(["overview"]);
  });

  it("stacks saved before the home page get one when the app starts", async () => {
    localStorage.setItem("soloyard.projectPanel", JSON.stringify({ open: false, cwd: "/p/a", stack: [{ view: "issues" }, { view: "issue", itemId: "5" }] }));
    vi.resetModules();
    const fresh = await import("./projectPanel");
    fresh.toggleProjectPanel("/p/a");
    expect(path()).toEqual(["overview", "issues", "5"]);
  });

  it("follows the project: keeps the module, drops details and service logs", () => {
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5" });
    retargetProjectPanel("/p/b/");
    expect(read()).toMatchObject({ open: true, cwd: "/p/b/" });
    expect(path()).toEqual(["overview", "issues"]);
    expect(panelShownFor(read(), "/p/b")).toBe(true);
    expect(panelShownFor(read(), "/p/a")).toBe(false);
    openInProjectPanel({ cwd: "/p/b", view: "service", itemId: "dev", title: "dev" });
    retargetProjectPanel("/p/c");
    expect(read()).toMatchObject({ open: true, cwd: "/p/c" });
    expect(path()).toEqual(["overview"]);
  });

  it("switching sessions takes a full view back to where it was expanded from", () => {
    toggleProjectPanel("/p/a");
    toggleProjectPanelFloat();
    toggleProjectPanelFull();
    exitProjectPanelFull();
    expect(read()).toMatchObject({ open: true, mode: "float" });
    exitProjectPanelFull();
    expect(read().mode).toBe("float");
  });

  it("reopens beside the session, not in full view", () => {
    toggleProjectPanel("/p/a");
    toggleProjectPanelFull();
    toggleProjectPanel("/p/a");
    toggleProjectPanel("/p/a");
    expect(read()).toMatchObject({ open: true, mode: "dock" });
    toggleProjectPanelFloat();
    toggleProjectPanelFull();
    toggleProjectPanel("/p/a");
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5" });
    expect(read()).toMatchObject({ open: true, mode: "float" });
  });

  it("service logs hang straight under home", () => {
    openInProjectPanel({ cwd: "/p/a", view: "service", itemId: "dev", title: "dev" });
    openInProjectPanel({ cwd: "/p/a", view: "service", itemId: "test", title: "test" });
    expect(read().stack).toEqual([{ view: "overview" }, { view: "service", itemId: "test", title: "test" }]);
  });

  it("full view returns to the mode it came from", () => {
    toggleProjectPanelFloat();
    toggleProjectPanelFull();
    expect(read().mode).toBe("full");
    toggleProjectPanelFull();
    expect(read().mode).toBe("float");
    toggleProjectPanelFull();
    toggleProjectPanelFloat();
    expect(read()).toMatchObject({ mode: "dock", restoreMode: "dock" });
  });

  it("keeps the floating box inside the session area", () => {
    expect(clampFloatRect({ x: 900, y: -20, w: 500, h: 2000 }, 1000, 700)).toEqual({ x: 500, y: 0, w: 500, h: 700 });
    expect(clampFloatRect({ x: 10, y: 10, w: 50, h: 50 }, 1000, 700)).toEqual({ x: 10, y: 10, w: 320, h: 200 });
  });
});
