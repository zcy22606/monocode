/**
 * Soloyard：侧栏「Project」分页里的竖排视图，点一项在右边开成顶层标签（同一项只开一个）。
 * 现在只有布局和交互，内容是占位，等交互确认后再接数据。
 */
import { t } from "../../../i18n";
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
  | "decision"
  /** 「服务」分页打开的日志标签，itemId 是「目录 + 命令」（services/history.ts 的 entryKey）。 */
  | "service";

export type ProjectViewSource = {
  view: ProjectViewId;
  /** 详情类标签（某个 issue / 文档 / 决策）的条目 id。 */
  itemId?: string;
};

type NavView = { id: ProjectViewId; group: "work" | "plan" };

/** 侧栏里的顺序：上面是天天用的，下面是做产品规划时用的。 */
export const NAV_VIEWS: NavView[] = [
  { id: "overview", group: "work" },
  { id: "issues", group: "work" },
  { id: "cycles", group: "work" },
  { id: "docs", group: "work" },
  { id: "decisions", group: "plan" },
  { id: "features", group: "plan" },
  { id: "scope", group: "plan" },
  { id: "evidence", group: "plan" },
];

/** 渲染时调用，跟着当前语言走。 */
export const viewLabel = (view: ProjectViewId) => t(`soloyard:view.${view}`);

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
const VIEW_IDS: readonly ProjectViewId[] = [
  "overview", "issues", "cycles", "docs", "decisions", "features", "scope", "evidence", "issue", "doc", "decision", "service",
];

/** 恢复标签布局时校验 projectView 字段（底座的快照解析对标签字段走白名单）。不认识的返回 undefined。 */
export function sanitizeProjectView(raw: unknown): ProjectViewSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (!VIEW_IDS.includes(value.view as ProjectViewId)) return undefined;
  return {
    view: value.view as ProjectViewId,
    ...(typeof value.itemId === "string" && value.itemId ? { itemId: value.itemId } : {}),
  };
}


export function projectViewKey(cwd: string, source: ProjectViewSource) {
  return `project-view:${cwd}:${source.view}:${source.itemId ?? ""}`;
}
