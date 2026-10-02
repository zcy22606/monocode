import type { IssueDetail } from "./issues";

type ProjectInfo = { name: string; goal?: string };

/**
 * 「开工」时预先填进新会话输入框的提示词：项目、issue、验收标准，以及开工 / 做完时怎么改状态。
 * 用户在输入框里能改，选好模型和工作区后自己发送。
 */
export function startWorkPrompt(issue: IssueDetail, project: ProjectInfo, cwd: string): string {
  const lines = [`开始处理 ${issue.ident}：${issue.title}`, ""];
  if (issue.body_md.trim()) lines.push(issue.body_md.trim(), "");
  if (issue.acceptance.length) {
    lines.push("验收标准：", ...issue.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  }
  const context = [`项目：${project.name}（${cwd}）`];
  if (project.goal?.trim()) context.push(`目标：${project.goal.trim()}`);
  if (issue.labels.length) context.push(`标签：${issue.labels.join("、")}`);
  if (issue.blockedBy.some((b) => b.status !== "done" && b.status !== "canceled")) {
    context.push(`注意：还有未完成的前置 issue：${issue.blockedBy.map((b) => b.ident).join("、")}`);
  }
  lines.push(...context, "");
  lines.push(
    `开始前用 Soloyard 的 MCP 工具把 ${issue.ident} 改成 in_progress。`,
    "做完后：",
    "1. 逐条对照验收标准自查，说明每条是怎么验证的（命令和结果）。",
    `2. 把 ${issue.ident} 改成 in_review，并加一条评论：改了什么、怎么验证的。不要改成 done，验收由我来做。`,
  );
  return lines.join("\n");
}
