/**
 * Soloyard：侧栏「Project」分页里的竖排视图，点一项在右边开成顶层标签（同一项只开一个）。
 * 现在只有布局和交互，内容是占位，等交互确认后再接数据。
 */
import type { FilePaneTab } from "../../workspace/model/layout";

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
  | "decision";

export type ProjectViewSource = {
  view: ProjectViewId;
  /** 详情类标签（某个 issue / 文档 / 决策）的条目 id。 */
  itemId?: string;
};

type NavView = { id: ProjectViewId; label: string; group: "work" | "plan" };

/** 侧栏里的顺序：上面是天天用的，下面是做产品规划时用的。 */
export const NAV_VIEWS: NavView[] = [
  { id: "overview", label: "Overview", group: "work" },
  { id: "issues", label: "Issues", group: "work" },
  { id: "cycles", label: "Cycles", group: "work" },
  { id: "docs", label: "Docs", group: "work" },
  { id: "decisions", label: "Decisions", group: "plan" },
  { id: "features", label: "Feature Map", group: "plan" },
  { id: "scope", label: "Scope", group: "plan" },
  { id: "evidence", label: "Evidence", group: "plan" },
];

export const viewLabel = (view: ProjectViewId) =>
  NAV_VIEWS.find((entry) => entry.id === view)?.label ?? view;

export type OpenProjectViewRequest = ProjectViewSource & {
  cwd: string;
  /** 标签上显示的名字；不能含 `/`（标签名取 path 的 basename）。 */
  title: string;
};

const OPEN_EVENT = "soloyard:open-project-view";

/** 侧栏和标签内容都用它开标签，不用把回调一层层传下去。 */
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

export function projectViewFile(request: OpenProjectViewRequest): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: request.title.split("/").join("∕"),
    cwd: request.cwd,
    projectView: { view: request.view, itemId: request.itemId },
  };
}

export function projectViewKey(cwd: string, source: ProjectViewSource) {
  return `project-view:${cwd}:${source.view}:${source.itemId ?? ""}`;
}
