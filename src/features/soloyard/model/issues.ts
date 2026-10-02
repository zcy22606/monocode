/** Soloyard issue 的前端类型和固定枚举。 */

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
};

export type IssueDetail = Omit<Issue, "sessions" | "children"> & {
  acceptance: { id: number; text: string; done: number; sort: number }[];
  children: { id: number; ident: string; title: string; status: IssueStatus }[];
  blockedBy: { id: number; ident: string; title: string; status: IssueStatus }[];
  comments: { id: number; actor: string; body_md: string; created_at: string }[];
  sessions: { id: string; title?: string; harness?: string; updated_at?: number; missing?: boolean }[];
};

export const STATUSES: { id: IssueStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In Progress" },
  { id: "in_review", label: "In Review" },
  { id: "done", label: "Done" },
  { id: "canceled", label: "Canceled" },
];

export const PRIORITIES: { id: number; label: string }[] = [
  { id: 1, label: "Urgent" },
  { id: 2, label: "High" },
  { id: 3, label: "Medium" },
  { id: 4, label: "Low" },
  { id: 0, label: "No priority" },
];

export const statusLabel = (status: string) => STATUSES.find((s) => s.id === status)?.label ?? status;
export const priorityLabel = (priority: number) => PRIORITIES.find((p) => p.id === priority)?.label ?? String(priority);
export const isCompleted = (status: IssueStatus) => status === "done" || status === "canceled";
