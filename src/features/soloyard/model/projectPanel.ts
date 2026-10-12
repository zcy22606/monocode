/**
 * Soloyard：右侧项目面板（SOL-66）。顶栏的开关按钮开 / 收，openProjectView 也开在这里，不再开顶层标签。
 * 导航是「主页 + 子页」：栈底永远是概览（项目主页），往上是一个模块（Issues、迭代、文档……），再往上是点进去的详情。
 * 标题栏是面包屑，模块那一段带下拉，平级切换一步到位；点「概览」回主页，返回键一层层退。
 * 全窗口一个，切会话时保持打开（满屏的退回侧栏），切到别的项目留在同一个模块。状态存 localStorage，重启后还原。
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
  /** [概览, 模块?, 详情…]：第一项永远是概览，返回就是出栈。 */
  stack: PanelEntry[];
};

/** 项目主页：栈底。放在 load() 前面：模块加载时 load() 就要用到。 */
const HOME: PanelEntry = { view: "overview" };
/** 以前存的栈（第一项是某个列表视图）补上主页。 */
function withHome(stack: PanelEntry[]): PanelEntry[] {
  if (!stack.length) return stack;
  return stack[0].view === "overview" ? stack : [HOME, ...stack];
}
/** 栈里的模块（第二项）：Issues、迭代、文档……；在主页时是 undefined。 */
export const panelModule = (stack: PanelEntry[]) => stack[1];

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
    return { ...INITIAL, ...saved, mode, stack: Array.isArray(saved.stack) ? withHome(saved.stack) : [] };
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

/** 顶栏开关：开着就收起；否则打开——同一项目回到上次停的地方（连详情一起），换了项目从主页开始。 */
export function toggleProjectPanel(cwd: string) {
  if (panelShownFor(state, cwd)) {
    set({ open: false });
    return;
  }
  set({ open: true, mode: reopenMode(), cwd, stack: sameCwd(state.cwd, cwd) && state.stack.length ? state.stack : [HOME] });
}

/** 换模块（面包屑下拉、主页的模块卡片）：概览 = 回主页，否则 [概览, 模块]，原来的详情丢掉。 */
export function selectProjectPanelView(view: ProjectViewId) {
  set({ stack: view === "overview" ? [HOME] : [HOME, { view }] });
}

/** 点面包屑的某一段：退到那一层。 */
export function popProjectPanelTo(index: number) {
  if (index >= 0 && index < state.stack.length - 1) set({ stack: state.stack.slice(0, index + 1) });
}

/**
 * openProjectView 落到这里，都挂在主页下面：模块 → [概览, 模块]；详情压栈（同一模块下接着压，否则从它的模块开始）；
 * 没有模块的视图（服务日志）直接挂在主页下。
 */
export function openInProjectPanel(request: OpenProjectViewRequest) {
  if (!panelShown(state)) set({ mode: reopenMode() });
  const entry: PanelEntry = { view: request.view, ...(request.itemId ? { itemId: request.itemId } : {}), title: request.title };
  const nav = navOf(request.view);
  if (request.view === "overview") {
    set({ open: true, cwd: request.cwd, stack: [HOME] });
    return;
  }
  if (nav === request.view && !request.itemId) {
    set({ open: true, cwd: request.cwd, stack: [HOME, { view: nav }] });
    return;
  }
  if (nav === request.view) {
    set({ open: true, cwd: request.cwd, stack: [HOME, entry] });
    return;
  }
  const continues = panelShown(state) && sameCwd(state.cwd, request.cwd) && panelModule(state.stack)?.view === nav;
  const base = continues ? state.stack : [HOME, { view: nav }];
  const stack = sameEntry(base[base.length - 1], entry) ? base : [...base, entry];
  set({ open: true, cwd: request.cwd, stack });
}

export function backProjectPanel() {
  if (state.stack.length > 1) set({ stack: state.stack.slice(0, -1) });
}

/** 切到别的项目：留在同一个模块（没有就是主页）；详情和服务日志属于旧项目，丢掉。 */
export function retargetProjectPanel(cwd: string) {
  if (sameCwd(state.cwd, cwd)) return;
  const module = panelModule(state.stack);
  const keep = module && !module.itemId ? [HOME, { view: module.view }] : [HOME];
  set({ cwd, stack: state.stack.length ? keep : [] });
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
