/** Soloyard issue 的前端类型和固定枚举。显示用的名字在 i18n（soloyard:status.* / soloyard:priority.*），渲染时再翻。 */
import { t } from "../../../i18n";

export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";

export type Issue = {
  id: number;
  project_id: number;
  number: number;
  ident: string;
  title: string;
  body_md: string;
  status: IssueStatus;
  priority: number;
  labels: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
  children: number;
  children_done: number;
  sessions: number;
  /** 在哪个成员仓库做（路径）；null = 项目根目录。 */
  repo_path: string | null;
  parent_id: number | null;
};

export type IssueDetail = Omit<Issue, "sessions" | "children"> & {
  /** 功能不在任何迭代里：收在功能表，不进 Issues 列表。 */
  parked: number;
  acceptance: { id: number; text: string; done: number; sort: number }[];
  children: { id: number; ident: string; title: string; status: IssueStatus; priority: number; repo_path: string | null; blocked: number; labels: string[] }[];
  parent: { id: number; ident: string; title: string; status: IssueStatus } | null;
  blockedBy: { id: number; ident: string; title: string; status: IssueStatus }[];
  comments: { id: number; actor: string; body_md: string; created_at: string }[];
  sessions: { id: string; title?: string; harness?: string; updated_at?: number; missing?: boolean }[];
};

/** 工作流顺序。 */
export const STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
/** 紧急在前，「无优先级」排最后。 */
export const PRIORITIES: number[] = [1, 2, 3, 4, 0];

export const statusLabel = (status: IssueStatus) => t(`soloyard:status.${status}`);
export const priorityLabel = (priority: number) => t(`soloyard:priority.${String(priority) as "0" | "1" | "2" | "3" | "4"}`);
export const isCompleted = (status: IssueStatus) => status === "done" || status === "canceled";

/** 仓库路径 → 显示名（目录名）。 */
export const repoName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
