/**
 * 手机上的 issue（SOL-100，原型 v1 A）：数据在电脑的库里，经网关请那台电脑的数据进程读写（soloyard/core/src/phone.ts 白名单），
 * 开工交给电脑界面开会话。验收、打回、开工提示词照电脑上的做法（acceptIssue.ts、IssueDetail.tsx、startWork.ts），文案原样搬。
 */
import { t } from "../i18n";
import { relayMirror } from "./host";
import { rpc } from "./rpc";

export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export const STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
/** 紧急在前，「无优先级」排最后。 */
export const PRIORITIES = [1, 2, 3, 4, 0];

export type IssueBrief = { id: number; ident: string; title: string; status: IssueStatus; priority: number };
export type IssueRow = IssueBrief & { current: boolean; sessions: string[] };
export type ProjectIssues = {
  project: { id: number; key: string; name: string };
  iteration: { id: number; tag: string; name: string; done: number; total: number } | null;
  issues: IssueRow[];
  /** 会话 id → 它挂的 issue（会话行上的编号、会话页顶上那一条）。 */
  sessionIssues: Record<string, IssueBrief>;
} | null;
export type IssueDetail = IssueBrief & {
  project_id: number;
  body_md: string;
  labels: string[];
  repo_path: string | null;
  acceptance: { id: number; text: string; done: number }[];
  comments: { id: number; actor: string; body_md: string; created_at: string }[];
  /** 挂着的会话，新的在前；missing = 没发出去就关掉的。 */
  sessions: { id: string; title?: string; harness?: string; updated_at?: number; missing?: boolean }[];
  blockedBy: { id: number; ident: string; title: string; status: IssueStatus }[];
};

const data = <T,>(cwd: string, method: string, args: unknown[]) => rpc<T>("soloyard.data", { cwd, method, args });

export const projectIssues = (cwd: string) => data<ProjectIssues>(cwd, "projectIssues", [cwd]);
export const getIssue = (cwd: string, id: number) => data<IssueDetail | null>(cwd, "getIssue", [id]);
export const createIssue = (cwd: string, projectId: number, title: string, priority?: number) =>
  data<number>(cwd, "createIssue", [projectId, { title, ...(priority !== undefined ? { priority } : {}) }]);
export const updateIssue = (cwd: string, id: number, patch: { status?: IssueStatus; priority?: number }) => data(cwd, "updateIssue", [id, patch]);
export const addComment = (cwd: string, id: number, body: string) => data(cwd, "addComment", [id, body]);
export const linkIssue = (cwd: string, sessionId: string, issueId: number) => data(cwd, "linkIssue", [sessionId, issueId]);

export const statusLabel = (s: IssueStatus) => t(`status.${s}`);
export const priorityLabel = (p: number) => t(`priority.${p}`);
const repoName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

type MergeResult =
  | { merged: true; commit: string; repo: string; branch: string; target: string }
  | { merged: false; reason: "nothing" | "already" }
  | { merged: false; reason: "dirty-worktree" | "dirty-main" | "conflict" | "no-target" | "failed"; files: string[]; message?: string; repo: string; branch: string; target: string };

/** 通过：先把 issue 工作树的分支合进主分支，合上了留评论再改成已完成；合不了不改状态，返回原因。 */
export async function acceptIssue(cwd: string, id: number): Promise<string | null> {
  const r = await data<MergeResult>(cwd, "mergeIssueBranch", [id]);
  if (!r.merged && "files" in r) {
    const files = r.files.slice(0, 5).join(t("prompt.listSeparator")) + (r.files.length > 5 ? " …" : "");
    const repo = repoName(r.repo);
    if (r.reason === "dirty-worktree") return t("merge.dirtyWorktree", { branch: r.branch, count: r.files.length, files });
    if (r.reason === "dirty-main") return t("merge.dirtyMain", { repo, files });
    if (r.reason === "conflict") return t("merge.conflict", { branch: r.branch, repo, target: r.target, files });
    if (r.reason === "no-target") return t("merge.noTarget", { repo });
    return t("merge.failed", { message: r.message ?? "" });
  }
  if (r.merged) await addComment(cwd, id, t("merge.comment", { branch: r.branch, repo: repoName(r.repo), target: r.target, commit: r.commit }));
  await updateIssue(cwd, id, { status: "done" });
  return null;
}

/** 打回：原因记成评论，退回进行中，再发给最近的那个会话让 agent 接着改。 */
export async function sendBack(cwd: string, issue: IssueDetail, reason: string) {
  await addComment(cwd, issue.id, t("prompt.sentBackComment", { reason }));
  await updateIssue(cwd, issue.id, { status: "in_progress" });
  const latest = issue.sessions.find((s) => !s.missing);
  if (latest) await relayMirror(latest.id, t("prompt.sentBackMessage", { ident: issue.ident, reason }), crypto.randomUUID());
}

/** 开工提示词（照电脑 startWork.ts 的 startWorkPrompt；项目目标手机上拿不到，不带）。 */
export function startPrompt(issue: IssueDetail, projectName: string, cwd: string) {
  const sep = t("prompt.listSeparator");
  const lines = [t("prompt.start", { ident: issue.ident, title: issue.title }), ""];
  if (issue.body_md.trim()) lines.push(issue.body_md.trim(), "");
  if (issue.acceptance.length) lines.push(t("prompt.acceptance"), ...issue.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  const context = [t("prompt.project", { name: projectName, cwd })];
  if (issue.repo_path) context.push(t("prompt.repo", { name: repoName(issue.repo_path), path: issue.repo_path }));
  if (issue.labels.length) context.push(t("prompt.labels", { labels: issue.labels.join(sep) }));
  const blockers = issue.blockedBy.filter((b) => b.status !== "done" && b.status !== "canceled");
  if (blockers.length) context.push(t("prompt.blockers", { issues: blockers.map((b) => b.ident).join(sep) }));
  lines.push(...context, "");
  lines.push(t("prompt.begin", { ident: issue.ident }), t("prompt.whenDone"), t("prompt.selfCheck"), t("prompt.report", { ident: issue.ident }));
  if (issue.repo_path) lines.push(t("prompt.commitInWorktree"));
  return lines.join("\n");
}

/** 开工：交给电脑界面开新会话、直接发出去、挂到 issue 上；带仓库的在那个仓库的新工作树里。 */
export const startWork = (cwd: string, issue: IssueDetail, prompt: string, model?: { harness: string; model: string; settings: Record<string, string> }) =>
  rpc<{ relayed: boolean }>("soloyard.startWork", {
    cwd,
    issueId: issue.id,
    prompt,
    ...(issue.repo_path ? { workCwd: issue.repo_path } : {}),
    ...(model ? { model } : {}),
    commandId: crypto.randomUUID(),
  });
