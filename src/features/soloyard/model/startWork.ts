import { t } from "../../../i18n";
import { repoName, type IssueDetail } from "./issues";

type ProjectInfo = { name: string; goal?: string };

/**
 * 「开工」时预先填进新会话输入框的提示词：项目、issue、验收标准，以及开工 / 做完时怎么改状态。
 * 用户在输入框里能改，选好模型和工作区后自己发送。
 */
export function startWorkPrompt(issue: IssueDetail, project: ProjectInfo, cwd: string): string {
  const ident = issue.ident;
  const sep = t("soloyard:prompt.listSeparator");
  const lines = [t("soloyard:prompt.start", { ident, title: issue.title }), ""];
  if (issue.body_md.trim()) lines.push(issue.body_md.trim(), "");
  if (issue.acceptance.length) {
    lines.push(t("soloyard:prompt.acceptance"), ...issue.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  }
  const context = [t("soloyard:prompt.project", { name: project.name, cwd })];
  if (issue.repo_path) context.push(t("soloyard:prompt.repo", { name: repoName(issue.repo_path), path: issue.repo_path }));
  if (project.goal?.trim()) context.push(t("soloyard:prompt.goal", { goal: project.goal.trim() }));
  if (issue.labels.length) context.push(t("soloyard:prompt.labels", { labels: issue.labels.join(sep) }));
  if (issue.blockedBy.some((b) => b.status !== "done" && b.status !== "canceled")) {
    context.push(t("soloyard:prompt.blockers", { issues: issue.blockedBy.map((b) => b.ident).join(sep) }));
  }
  lines.push(...context, "");
  lines.push(t("soloyard:prompt.begin", { ident }), t("soloyard:prompt.whenDone"), t("soloyard:prompt.selfCheck"), t("soloyard:prompt.report", { ident }));
  // 带仓库的 issue 在新工作树里做：验收通过时应用把这个分支合进主分支，所以改动要先提交到分支上
  if (issue.repo_path) lines.push(t("soloyard:prompt.commitInWorktree"));
  return lines.join("\n");
}
