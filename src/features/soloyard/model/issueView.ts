/**
 * Issue 视图：字段注册表 + 视图配置 + 应用配置（筛选 → 排序 → 分组）。
 *
 * 低耦合的关键是「字段」：一个字段声明自己能不能分组、排序、筛选、显示成属性，以及拖到某一组时怎么改 issue。
 * 列表视图、看板视图、筛选菜单、显示设置都只认字段接口，不认具体字段。加一个新维度（cycle、负责人、截止日……）
 * 只需要在 ISSUE_FIELDS 里注册一条。
 */
import { PRIORITIES, STATUSES, isCompleted, type Issue } from "./issues";

export type FieldId = "status" | "priority" | "labels" | "created" | "updated" | "id" | "sessions";

export type FieldOption = { key: string; label: string };

export type IssueField = {
  id: FieldId;
  label: string;
  /** 能分组：列出所有组（按显示顺序）、一个 issue 落在哪些组、拖到某组时要改什么。 */
  group?: {
    options: (issues: Issue[]) => FieldOption[];
    keysOf: (issue: Issue) => string[];
    /** 不提供 = 这个分组不能靠拖动 / 在组里新建来改值。 */
    patchFor?: (key: string, issue?: Issue) => Partial<Issue> | null;
  };
  /** 能排序：升序比较函数。 */
  compare?: (a: Issue, b: Issue) => number;
  /** 能筛选：候选值 + 匹配（选中的值之间是「任一」）。 */
  filter?: {
    options: (issues: Issue[]) => FieldOption[];
    matches: (issue: Issue, values: string[]) => boolean;
  };
  /** 能在行 / 卡片上显示。 */
  display?: boolean;
};

const NO_LABEL = "__none__";
const byPriority = (p: number) => (p === 0 ? 9 : p); // 无优先级排最后

export const ISSUE_FIELDS: Record<FieldId, IssueField> = {
  status: {
    id: "status",
    label: "Status",
    group: {
      options: () => STATUSES.map((s) => ({ key: s.id, label: s.label })),
      keysOf: (issue) => [issue.status],
      patchFor: (key) => ({ status: key as Issue["status"] }),
    },
    compare: (a, b) => STATUSES.findIndex((s) => s.id === a.status) - STATUSES.findIndex((s) => s.id === b.status),
    filter: {
      options: () => STATUSES.map((s) => ({ key: s.id, label: s.label })),
      matches: (issue, values) => values.includes(issue.status),
    },
    display: true,
  },
  priority: {
    id: "priority",
    label: "Priority",
    group: {
      options: () => PRIORITIES.map((p) => ({ key: String(p.id), label: p.label })),
      keysOf: (issue) => [String(issue.priority)],
      patchFor: (key) => ({ priority: Number(key) }),
    },
    compare: (a, b) => byPriority(a.priority) - byPriority(b.priority),
    filter: {
      options: () => PRIORITIES.map((p) => ({ key: String(p.id), label: p.label })),
      matches: (issue, values) => values.includes(String(issue.priority)),
    },
    display: true,
  },
  labels: {
    id: "labels",
    label: "Labels",
    group: {
      options: (issues) => [
        ...[...new Set(issues.flatMap((i) => i.labels))].sort().map((l) => ({ key: l, label: l })),
        { key: NO_LABEL, label: "No labels" },
      ],
      keysOf: (issue) => (issue.labels.length ? issue.labels : [NO_LABEL]),
      // 拖到某个标签组 = 加上这个标签；拖到「无标签」= 清空
      patchFor: (key, issue) =>
        key === NO_LABEL ? { labels: [] } : { labels: [...new Set([...(issue?.labels ?? []), key])] },
    },
    filter: {
      options: (issues) => [...new Set(issues.flatMap((i) => i.labels))].sort().map((l) => ({ key: l, label: l })),
      matches: (issue, values) => issue.labels.some((l) => values.includes(l)),
    },
    display: true,
  },
  created: {
    id: "created",
    label: "Created",
    compare: (a, b) => a.created_at.localeCompare(b.created_at),
    display: true,
  },
  updated: {
    id: "updated",
    label: "Updated",
    compare: (a, b) => a.updated_at.localeCompare(b.updated_at),
    display: true,
  },
  id: { id: "id", label: "ID", compare: (a, b) => a.number - b.number, display: true },
  sessions: { id: "sessions", label: "Sessions", display: true },
};

export const groupableFields = () => Object.values(ISSUE_FIELDS).filter((f) => f.group);
export const sortableFields = () => Object.values(ISSUE_FIELDS).filter((f) => f.compare);
export const filterableFields = () => Object.values(ISSUE_FIELDS).filter((f) => f.filter);
export const displayableFields = () => Object.values(ISSUE_FIELDS).filter((f) => f.display);

export type IssueViewFilter = { field: FieldId; values: string[] };

export type IssueViewConfig = {
  layout: "list" | "board";
  /** 列表的分组 = 看板的列。 */
  groupBy: FieldId | null;
  orderBy: FieldId;
  orderDesc: boolean;
  showCompleted: boolean;
  showEmptyGroups: boolean;
  properties: FieldId[];
  filters: IssueViewFilter[];
};

export const DEFAULT_VIEW: IssueViewConfig = {
  layout: "list",
  groupBy: "status",
  orderBy: "priority",
  orderDesc: false,
  showCompleted: true,
  showEmptyGroups: false,
  properties: ["id", "status", "priority", "labels", "created"],
  filters: [],
};

export type IssueGroup = { key: string; label: string; issues: Issue[] };

/** 筛选 → 排序 → 分组。没有分组时返回一个 key 为 "all" 的组。 */
export function applyView(issues: Issue[], view: IssueViewConfig): IssueGroup[] {
  const visible = issues.filter(
    (issue) =>
      (view.showCompleted || !isCompleted(issue.status)) &&
      view.filters.every((f) => !f.values.length || ISSUE_FIELDS[f.field]?.filter?.matches(issue, f.values) !== false),
  );
  const compare = ISSUE_FIELDS[view.orderBy]?.compare;
  const sorted = compare ? [...visible].sort((a, b) => (view.orderDesc ? -1 : 1) * compare(a, b) || a.number - b.number) : visible;
  const group = view.groupBy ? ISSUE_FIELDS[view.groupBy]?.group : undefined;
  if (!group) return [{ key: "all", label: "All issues", issues: sorted }];
  const groups = group.options(issues).map((option) => ({ ...option, issues: [] as Issue[] }));
  for (const issue of sorted) {
    for (const key of group.keysOf(issue)) groups.find((g) => g.key === key)?.issues.push(issue);
  }
  const shown = view.showCompleted ? groups : groups.filter((g) => !(view.groupBy === "status" && isCompleted(g.key as Issue["status"])));
  return view.showEmptyGroups ? shown : shown.filter((g) => g.issues.length);
}

/** 每个项目记住自己的视图；读的时候和默认值合并，以后加了新配置项旧数据也能用。 */
const viewKey = (projectId: number) => `soloyard.issueView.${projectId}`;

export function loadIssueView(projectId: number): IssueViewConfig {
  try {
    const raw = localStorage.getItem(viewKey(projectId));
    if (!raw) return DEFAULT_VIEW;
    const saved = JSON.parse(raw) as Partial<IssueViewConfig>;
    const known = (id: unknown): id is FieldId => typeof id === "string" && id in ISSUE_FIELDS;
    return {
      ...DEFAULT_VIEW,
      ...saved,
      groupBy: saved.groupBy === null || known(saved.groupBy) ? (saved.groupBy ?? null) : DEFAULT_VIEW.groupBy,
      orderBy: known(saved.orderBy) ? saved.orderBy : DEFAULT_VIEW.orderBy,
      properties: (saved.properties ?? DEFAULT_VIEW.properties).filter(known),
      filters: (saved.filters ?? []).filter((f) => known(f.field)),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveIssueView(projectId: number, view: IssueViewConfig) {
  try {
    localStorage.setItem(viewKey(projectId), JSON.stringify(view));
  } catch {
    // private mode / quota
  }
}
