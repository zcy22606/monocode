// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
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
  type ProjectPanelState,
} from "./projectPanel";

// 每次改动都会存进 localStorage，直接读它就是当前状态
const read = (): ProjectPanelState => JSON.parse(localStorage.getItem("soloyard.projectPanel")!);

beforeEach(() => {
  localStorage.clear();
  resetProjectPanel();
});

describe("project panel", () => {
  it("the title-bar button opens Issues by default, then whatever was last open", () => {
    toggleProjectPanel("/p/a");
    expect(read()).toMatchObject({ open: true, cwd: "/p/a", stack: [{ view: "issues" }] });
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5 x" });
    toggleProjectPanel("/p/a");
    expect(read().open).toBe(false);
    // 同一项目：连详情一起回来
    toggleProjectPanel("/p/a");
    expect(read().stack.map((e) => e.itemId ?? e.view)).toEqual(["issues", "5"]);
    selectProjectPanelView("cycles");
    toggleProjectPanel("/p/a");
    // 别的项目：同一个列表视图
    toggleProjectPanel("/p/b");
    expect(read()).toMatchObject({ open: true, cwd: "/p/b", stack: [{ view: "cycles" }] });
    expect(panelShownFor(read(), "/p/a")).toBe(false);
  });

  it("details push and back pops; opening a detail from elsewhere starts at its list", () => {
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5" });
    expect(read().stack.map((e) => e.itemId ?? e.view)).toEqual(["issues", "5"]);
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "6", title: "SOL-6" });
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "6", title: "SOL-6" });
    expect(read().stack.map((e) => e.itemId ?? e.view)).toEqual(["issues", "5", "6"]);
    backProjectPanel();
    expect(read().stack.map((e) => e.itemId ?? e.view)).toEqual(["issues", "5"]);
    openInProjectPanel({ cwd: "/p/a", view: "cycles", title: "Iterations" });
    expect(read().stack).toEqual([{ view: "cycles" }]);
  });

  it("follows the project: keeps the list view, drops details and list-less views", () => {
    openInProjectPanel({ cwd: "/p/a", view: "issue", itemId: "5", title: "SOL-5" });
    retargetProjectPanel("/p/b/");
    expect(read()).toMatchObject({ open: true, cwd: "/p/b/", stack: [{ view: "issues" }] });
    expect(panelShownFor(read(), "/p/b")).toBe(true);
    expect(panelShownFor(read(), "/p/a")).toBe(false);
    openInProjectPanel({ cwd: "/p/b", view: "service", itemId: "dev", title: "dev" });
    retargetProjectPanel("/p/c");
    expect(read()).toMatchObject({ open: false, stack: [] });
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

  it("service logs have no list to go back to", () => {
    openInProjectPanel({ cwd: "/p/a", view: "service", itemId: "dev", title: "dev" });
    openInProjectPanel({ cwd: "/p/a", view: "service", itemId: "test", title: "test" });
    expect(read().stack).toEqual([{ view: "service", itemId: "test", title: "test" }]);
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
