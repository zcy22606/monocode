/**
 * Soloyard：项目 overview 和阶段（数据在 soloyard/core/src/overview.ts、stage.ts）。
 * 概览页顶部是阶段和「下一步」：要用户自己做的跳到对应视图，要 agent 干活的在项目里开新会话、把提示词填进输入框（不自动发）。
 */
import { t } from "../../../i18n";
import { requestStartWork } from "./appActions";
import { openProjectView, viewLabel, type ProjectViewId } from "./projectViews";
import type { IterationPlan } from "./iterations";
import type { Issue } from "./issues";

export const FIELD_KEYS = ["name", "slug", "goal", "stoploss"] as const;
export const SECTION_KEYS = ["background", "users", "alternatives", "findings", "decisions", "scope", "metrics", "risks", "open"] as const;
export type OverviewKey = (typeof FIELD_KEYS)[number] | (typeof SECTION_KEYS)[number];
export type OverviewEntry = { key: OverviewKey; body: string; version: number; updated_by: string | null; updated_at: string | null };
export type Overview = { project_id: number; entries: OverviewEntry[] };

export type Stage = "idea" | "initiating" | "building" | "launched" | "parked" | "killed";
export type InitStep = "charter" | "decide" | "versions" | "cut";
/** 下一步的种类：想法期、立项各小步、建造期。 */
export type NextKey = "idea" | InitStep | "building";
export type StageInfo = {
  stage: Stage;
  step?: InitStep;
  next?: { key: NextKey; view?: ProjectViewId; prompt?: boolean };
  note?: { reason?: string; from?: Stage; at: string; by: string };
};
export type DecisionBrief = { id: number; code: string; title: string; door: string | null; status: string };

/** 进度条上的四个期。 */
export const MAIN_STAGES: Stage[] = ["idea", "initiating", "building", "launched"];
/** 立项期的小步，最后一步是「开始第一个迭代」（做了就进建造期）。 */
export const INIT_STEPS: (InitStep | "start")[] = ["charter", "decide", "versions", "cut", "start"];

export const entryOf = (o: Overview | undefined, key: OverviewKey) => o?.entries.find((e) => e.key === key);

/** 单向门在前、没定的在前。 */
export const pendingDecisions = (all: DecisionBrief[]) =>
  all.filter((d) => d.status !== "decided").sort((a, b) => Number(b.door === "one-way") - Number(a.door === "one-way"));

/** 「下一步」按钮：跳视图，或在项目里开会话并填好提示词。 */
export function runNextStep(cwd: string, next: NonNullable<StageInfo["next"]>) {
  if (next.view) openProjectView({ cwd, view: next.view, title: viewLabel(next.view) });
  else if (next.prompt) requestStartWork({ cwd, sessionId: crypto.randomUUID(), prompt: t(`soloyard:overview.prompt.${next.key as "charter" | "versions"}`) });
}

/** 「建议做」：product-thinking 的可选命令，同样开会话填提示词。 */
export const SUGGESTIONS = ["dig", "business", "tech", "prd"] as const;
export const runSuggestion = (cwd: string, key: (typeof SUGGESTIONS)[number]) =>
  requestStartWork({ cwd, sessionId: crypto.randomUUID(), prompt: t(`soloyard:overview.suggest.${key}.prompt`) });

// ───────────── 主页的模块卡片 ─────────────

/** 当前迭代卡：排在最前的进行中迭代（没有就是下一个计划中的），已建 issue 的功能里做完了几个。 */
export function iterationSummary(plan: IterationPlan | undefined) {
  if (!plan) return null;
  const it = plan.iterations.find((i) => i.status === "active") ?? plan.iterations.find((i) => i.status === "planned");
  if (!it) return null;
  const withIssue = plan.features.filter((f) => f.iteration_id === it.id && f.issue_id);
  const done = withIssue.filter((f) => f.issue_status === "done" || f.issue_status === "canceled").length;
  return { tag: it.tag, name: it.name, active: it.status === "active", done, total: withIssue.length };
}

/** Issues 卡：没做完的按状态数（只数顶层 issue，子任务算在主任务里）。 */
export function issueCounts(issues: Pick<Issue, "status" | "parent_id">[] | undefined) {
  const top = (issues ?? []).filter((i) => i.parent_id == null);
  const count = (s: Issue["status"]) => top.filter((i) => i.status === s).length;
  return { todo: count("todo"), inProgress: count("in_progress"), inReview: count("in_review") };
}
