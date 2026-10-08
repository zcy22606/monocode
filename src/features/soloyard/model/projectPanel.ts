/**
 * Soloyard：右侧项目面板（SOL-66）。顶栏的开关按钮开 / 收，标题栏下拉换视图，openProjectView 也开在这里，不再开顶层标签。
 * 全窗口一个，切会话时保持打开（满屏的退回侧栏），切到别的项目跟着换成那个项目的同一视图。
 * 状态存 localStorage，重启后还原。
 */
import { useSyncExternalStore } from "react";
import { navOf, type OpenProjectViewRequest, type ProjectViewId, type ProjectViewSource } from "./projectViews";

export type PanelMode = "dock" | "full" | "float";
/** 视图标题：详情用打开时给的名字，列表视图渲染时按语言取。 */
export type PanelEntry = ProjectViewSource & { title?: string };
export type FloatRect = { x: number; y: number; w: number; h: number };

export type ProjectPanelState = {
  open: boolean;
  mode: PanelMode;
  /** 满屏之前是侧栏还是悬浮，退出满屏回到它。 */
  restoreMode: "dock" | "float";
  width: number;
  float: FloatRect | null;
  cwd: string;
  /** 第一项是工具栏上的视图，后面是点进去的详情，返回就是出栈。 */
  stack: PanelEntry[];
};

const KEY = "soloyard.projectPanel";
export const PANEL_DEFAULT_WIDTH = 520;

const INITIAL: ProjectPanelState = {
  open: false,
  mode: "dock",
  restoreMode: "dock",
  width: PANEL_DEFAULT_WIDTH,
  float: null,
  cwd: "",
  stack: [],
};

function load(): ProjectPanelState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ProjectPanelState> | null;
    if (!saved) return INITIAL;
    // 启动时也不停在满屏
    const mode = saved.mode === "full" ? (saved.restoreMode ?? "dock") : (saved.mode ?? "dock");
    return { ...INITIAL, ...saved, mode, stack: Array.isArray(saved.stack) ? saved.stack : [] };
  } catch {
    return INITIAL;
  }
}

let state = typeof localStorage === "undefined" ? INITIAL : load();
const listeners = new Set<() => void>();

function set(patch: Partial<ProjectPanelState>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // private mode / quota
  }
  listeners.forEach((l) => l());
}

export function useProjectPanel(): ProjectPanelState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

const sameCwd = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
const sameEntry = (a: PanelEntry | undefined, b: PanelEntry) => a?.view === b.view && a.itemId === b.itemId;

export const panelShown = (panel: ProjectPanelState) => panel.open && panel.stack.length > 0;

/** 面板开着、而且是这个项目的（顶栏开关据此高亮）。 */
export const panelShownFor = (panel: ProjectPanelState, cwd: string) => panelShown(panel) && sameCwd(panel.cwd, cwd);

/** 从收起状态打开时的样子：满屏不留到下次，回到满屏前的侧栏（或悬浮）。 */
const reopenMode = (): PanelMode => (state.mode === "full" ? state.restoreMode : state.mode);

/** 顶栏开关：开着就收起；否则打开，回到上次看的视图（同一项目连详情一起），没看过就是 Issues。 */
export function toggleProjectPanel(cwd: string) {
  if (panelShownFor(state, cwd)) {
    set({ open: false });
    return;
  }
  const root = state.stack[0];
  const listView = root && (navOf(root.view) !== root.view || !root.itemId) ? navOf(root.view) : "issues";
  set({ open: true, mode: reopenMode(), cwd, stack: sameCwd(state.cwd, cwd) && root ? state.stack : [{ view: listView }] });
}

/** 标题栏下拉：换成这个视图。 */
export function selectProjectPanelView(view: ProjectViewId) {
  set({ stack: [{ view }] });
}

/**
 * openProjectView 落到这里：列表视图换掉整个栈；详情压栈（同一列表下接着压，否则从它的列表开始）；
 * 没有列表的视图（服务日志）单独一页。
 */
export function openInProjectPanel(request: OpenProjectViewRequest) {
  if (!panelShown(state)) set({ mode: reopenMode() });
  const entry: PanelEntry = { view: request.view, ...(request.itemId ? { itemId: request.itemId } : {}), title: request.title };
  const nav = navOf(request.view);
  if (nav === request.view && !request.itemId) {
    set({ open: true, cwd: request.cwd, stack: [{ view: nav }] });
    return;
  }
  const continues = panelShown(state) && sameCwd(state.cwd, request.cwd) && navOf(state.stack[0].view) === nav;
  const base = nav === request.view ? [] : continues ? state.stack : [{ view: nav }];
  const stack = sameEntry(base[base.length - 1], entry) ? base : [...base, entry];
  set({ open: true, cwd: request.cwd, stack });
}

export function backProjectPanel() {
  if (state.stack.length > 1) set({ stack: state.stack.slice(0, -1) });
}

/** 切到别的项目：留在同一个列表视图，详情属于旧项目，丢掉；服务日志这类没有列表的视图收起。 */
export function retargetProjectPanel(cwd: string) {
  if (sameCwd(state.cwd, cwd)) return;
  const root = state.stack[0];
  const keep = root && (navOf(root.view) !== root.view || !root.itemId) ? [{ view: navOf(root.view) }] : [];
  set({ cwd, stack: keep, open: state.open && keep.length > 0 });
}

/** 打开了别的会话或文件：满屏的退回满屏前的样子，让它露出来。 */
export function exitProjectPanelFull() {
  if (state.mode === "full") set({ mode: state.restoreMode });
}

export function toggleProjectPanelFull() {
  if (state.mode === "full") set({ mode: state.restoreMode });
  else set({ mode: "full", restoreMode: state.mode });
}

export function toggleProjectPanelFloat() {
  const mode = state.mode === "float" || (state.mode === "full" && state.restoreMode === "float") ? "dock" : "float";
  set({ mode, restoreMode: mode });
}

export function setProjectPanelWidth(width: number) {
  set({ width });
}

export function setProjectPanelFloat(float: FloatRect) {
  set({ float });
}

const FLOAT_MIN = { w: 320, h: 200 };

/** 悬浮框夹在会话区域（宽 width、高 height）里，不小于最小尺寸。 */
export function clampFloatRect(rect: FloatRect, width: number, height: number): FloatRect {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  const w = clamp(rect.w, FLOAT_MIN.w, width);
  const h = clamp(rect.h, FLOAT_MIN.h, height);
  return { w, h, x: clamp(rect.x, 0, width - w), y: clamp(rect.y, 0, height - h) };
}

/** 测试用：回到初始状态。 */
export function resetProjectPanel() {
  set(INITIAL);
}
