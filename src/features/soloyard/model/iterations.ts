/**
 * 迭代页的前端类型和纯逻辑。数据来自数据进程的 iterationPlan（soloyard/core/src/iterations.ts）。
 * 列 = 迭代（按先后，先后就是优先级）+ 三个 bucket（待定 / 另立项 / 不做）。功能的去处用 Target 表示。
 */
import { t } from "../../../i18n";
import type { IssueStatus } from "./issues";

export type Bucket = "pending" | "split" | "cut";
/** 功能的去处：迭代 id，或一个 bucket。 */
export type Target = number | Bucket;
export const BUCKETS: Bucket[] = ["pending", "split", "cut"];

export type IterationStatus = "planned" | "active" | "done";

export type Iteration = {
  id: number;
  tag: string;
  name: string;
  goal: string;
  target_date: string | null;
  status: IterationStatus;
  sort: number;
  /** 完成时冻结的统计。 */
  summary: { done: number; moved: number } | null;
};

export type Feature = {
  id: number;
  code: string;
  backbone: string | null;
  name: string;
  level: string | null;
  iteration_id: number | null;
  bucket: Bucket;
  /** AI 原本的安排：版本号或 bucket。 */
  ai_plan: string | null;
  reason: string | null;
  job: string | null;
  kano: string | null;
  evidence: string[];
  /** 竞品覆盖，如 "3/8"。 */
  prevalence: string | null;
  issue_id: number | null;
  issue_ident: string | null;
  issue_status: IssueStatus | null;
};

export type IterationPlan = { iterations: Iteration[]; features: Feature[]; backbones: Record<string, string> };

export type Column = { target: Target; kind: "release" | Bucket; iteration?: Iteration };

export const columnsOf = (iterations: Iteration[]): Column[] => [
  ...iterations.map((iteration) => ({ target: iteration.id, kind: "release" as const, iteration })),
  ...BUCKETS.map((bucket) => ({ target: bucket, kind: bucket })),
];

export const targetOf = (f: Feature): Target => f.iteration_id ?? f.bucket;

export const iterationLabel = (it: Iteration) => [it.tag, it.name].filter(Boolean).join(" · ");
export const bucketLabel = (bucket: Bucket) => t(`soloyard:iterations.bucket.${bucket}`);
export const columnLabel = (col: Column) => (col.iteration ? iterationLabel(col.iteration) : bucketLabel(col.kind as Bucket));

/** select 的 value 只能是字符串：迭代 id 存成数字串，bucket 原样。 */
export const encodeTarget = (target: Target) => String(target);
export const decodeTarget = (value: string): Target => (/^\d+$/.test(value) ? Number(value) : (value as Bucket));

/** 没做完 = 还没有 issue，或 issue 既没完成也没取消。 */
export const unfinished = (f: Feature) => !f.issue_status || (f.issue_status !== "done" && f.issue_status !== "canceled");

/** AI 安排的显示名：版本号原样，bucket 翻成「待定」这类。 */
export const planLabel = (plan: string) => ((BUCKETS as string[]).includes(plan) ? bucketLabel(plan as Bucket) : plan);

/** AI 原安排和现在不一样时，返回 AI 原安排的显示名。 */
export function aiMovedFrom(f: Feature, iterations: Iteration[]): string | null {
  if (!f.ai_plan) return null;
  const now = f.iteration_id ? iterations.find((i) => i.id === f.iteration_id)?.tag : f.bucket;
  return f.ai_plan === now ? null : planLabel(f.ai_plan);
}

const parseVersion = (v: string) => {
  const m = /^v?(\d+)(?:\.(\d+))?/i.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
};

/** 版本号查重：忽略大小写和前缀 v（v1.0 和 1.0 算同一个）。数据层同样校验。 */
export function versionTaken(iterations: Iteration[], tag: string, exceptId?: number) {
  const norm = (v: string) => v.trim().toLowerCase().replace(/^v/, "");
  return iterations.some((i) => i.id !== exceptId && norm(i.tag) === norm(tag));
}

/** 建议的下一个版本号：在现有最大版本上 +0.1（小版本）或 +1.0（大版本），已被占用就继续往上加。 */
export function suggestVersions(iterations: Iteration[]): { minor: string; major: string } {
  const [maj, min] = iterations
    .map((i) => parseVersion(i.tag))
    .filter((v) => v !== null)
    .reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a), [0, 0]);
  const free = (make: (n: number) => string) => {
    for (let n = 1; ; n++) if (!versionTaken(iterations, make(n))) return make(n);
  };
  return { minor: free((n) => `v${maj}.${min + n}`), major: free((n) => `v${maj + n}.0`) };
}
