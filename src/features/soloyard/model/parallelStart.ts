/**
 * Soloyard：主 issue 的「并行开工」。每个勾选的子 issue 在自己仓库的新工作树里开会话并直接开工，
 * 再在项目根目录开一个主会话负责协调和联调。会话之间不直接传话：子会话做完把自己的 issue 改成 in_review
 * 并评论，主会话经 MCP 读 issue 的状态和评论。
 */
import { t } from "../../../i18n";
import { repoName, type IssueDetail } from "./issues";

export type SubIssue = IssueDetail["children"][number];

/** 能开工：还没开始，前置都做完了。 */
export const canStart = (child: SubIssue) => !child.blocked && (child.status === "backlog" || child.status === "todo");

const where = (child: SubIssue) =>
  child.repo_path ? t("soloyard:prompt.lead.inRepo", { repo: repoName(child.repo_path) }) : t("soloyard:prompt.lead.atRoot");

/** 主会话的开工提示词：自己不做子任务，分工、看进度、全部 in_review 后在根目录联调。 */
export function leadPrompt(parent: IssueDetail, started: SubIssue[], project: { name: string }, cwd: string): string {
  const ident = parent.ident;
  const startedIds = new Set(started.map((c) => c.id));
  const waiting = parent.children.filter((c) => !startedIds.has(c.id) && c.status !== "done" && c.status !== "canceled");
  const lines = [t("soloyard:prompt.lead.role", { ident, title: parent.title }), ""];
  if (parent.body_md.trim()) lines.push(parent.body_md.trim(), "");
  if (parent.acceptance.length) lines.push(t("soloyard:prompt.acceptance"), ...parent.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  lines.push(t("soloyard:prompt.project", { name: project.name, cwd }), "");
  if (started.length) lines.push(t("soloyard:prompt.lead.started"), ...started.map((c) => `- ${c.ident} ${c.title} — ${where(c)}`), "");
  if (waiting.length) lines.push(t("soloyard:prompt.lead.waiting"), ...waiting.map((c) => `- ${c.ident} ${c.title} — ${where(c)}${c.blocked ? t("soloyard:prompt.lead.blocked") : ""}`), "");
  lines.push(
    t("soloyard:prompt.lead.progress", { ident }),
    t("soloyard:prompt.lead.now", { ident }),
    t("soloyard:prompt.lead.check"),
    t("soloyard:prompt.lead.integrate", { ident }),
  );
  return lines.join("\n");
}
