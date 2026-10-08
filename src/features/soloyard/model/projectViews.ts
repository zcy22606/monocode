/**
 * Soloyard：项目视图（Issues、迭代、文档……）。各处链接经 openProjectView 在右侧项目面板里打开（model/projectPanel.ts），面板标题栏的下拉切换。
 */
import { useSyncExternalStore } from "react";
import { t } from "../../../i18n";

export type ProjectViewId =
  | "overview"
  | "issues"
  | "cycles"
  | "docs"
  | "decisions"
  | "features"
  | "scope"
  | "evidence"
  | "issue"
  | "doc"
  | "decision"
  /** 「服务」分页打开的日志标签，itemId 是「目录 + 命令」（services/history.ts 的 entryKey）。 */
  | "service"
  /** 头脑风暴：不属于任何项目，侧栏收件箱下面进入。 */
  | "brainstorm"
  /** 项目由哪些仓库组成、项目说明、项目地图预览。 */
  | "repos";

export type ProjectViewSource = {
  view: ProjectViewId;
  /** 详情类标签（某个 issue / 文档 / 决策）的条目 id。 */
  itemId?: string;
};

/** 项目面板标题栏下拉里的视图，Issues 最常用、也是默认。 */
export const PANEL_VIEWS: ProjectViewId[] = [
  "issues",
  // 功能全景和减法并进了「迭代」：功能全景就是带版本号的迭代表，减法 = 把功能挪到别的迭代
  "cycles",
  "overview",
  "docs",
  "repos",
  "decisions",
  "evidence",
];

/** 详情 / 旧标签归到哪一项（issue 详情 → Issues，旧的功能全景 / 减法 → 迭代……）。 */
const NAV_OF: Partial<Record<ProjectViewId, ProjectViewId>> = { issue: "issues", doc: "docs", decision: "decisions", features: "cycles", scope: "cycles" };
export const navOf = (view: ProjectViewId) => NAV_OF[view] ?? view;

/**
 * 当前聚焦的标签是哪个项目视图：App 在活动标签变化时写入，左侧的「头脑风暴」入口据此高亮。
 * 放模块里而不是层层传 props，上游的 App 只多一行。
 */
let activeView: { cwd: string; nav: ProjectViewId } | null = null;
const activeListeners = new Set<() => void>();
export function setActiveProjectView(cwd: string | undefined, source: ProjectViewSource | undefined) {
  const next = cwd && source ? { cwd: cwd.replace(/\/+$/, ""), nav: navOf(source.view) } : null;
  if (next?.cwd === activeView?.cwd && next?.nav === activeView?.nav) return;
  activeView = next;
  activeListeners.forEach((l) => l());
}
/** 这个目录下当前聚焦的项目视图；不是这个目录、或当前不是项目视图时为 null。 */
export function useActiveProjectNav(cwd: string): ProjectViewId | null {
  const view = useSyncExternalStore(
    (l) => (activeListeners.add(l), () => activeListeners.delete(l)),
    () => activeView,
  );
  return view && view.cwd === cwd.replace(/\/+$/, "") ? view.nav : null;
}

/** 头脑风暴不属于任何项目：标签挂在 ~ 下，侧栏的「头脑风暴」据此高亮。 */
export const BRAINSTORM_CWD = "~";
export const openBrainstorm = () => openProjectView({ cwd: BRAINSTORM_CWD, view: "brainstorm", title: viewLabel("brainstorm") });
export const useBrainstormActive = () => useActiveProjectNav(BRAINSTORM_CWD) === "brainstorm";

/** 渲染时调用，跟着当前语言走。 */
export const viewLabel = (view: ProjectViewId) => t(`soloyard:view.${view}`);

export type OpenProjectViewRequest = ProjectViewSource & {
  cwd: string;
  /** 标签上显示的名字；不能含 `/`（标签名取 path 的 basename）。 */
  title: string;
};

const OPEN_EVENT = "soloyard:open-project-view";

/** 各处都用它开项目视图，不用把回调一层层传下去；项目面板监听。 */
export function openProjectView(request: OpenProjectViewRequest) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: request }));
}

export function onOpenProjectView(
  handler: (request: OpenProjectViewRequest) => void,
): () => void {
  const listener = (event: Event) =>
    handler((event as CustomEvent<OpenProjectViewRequest>).detail);
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function projectViewKey(cwd: string, source: ProjectViewSource) {
  return `project-view:${cwd}:${source.view}:${source.itemId ?? ""}`;
}
