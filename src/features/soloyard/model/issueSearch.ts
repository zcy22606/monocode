/**
 * Soloyard：全局搜索（底座 SearchView）里的 issue。搜索打开时取一次所有项目的 issue（含子 issue），
 * 之后按输入在前端过滤，和 Issues 页的搜索框用同一个 matchesIssueQuery。
 */
import { useEffect, useMemo, useState } from "react";
import { soloyardCall } from "../data/api";
import { isCompleted, type Issue, type IssueStatus } from "./issues";
import { matchesIssueQuery } from "./issueView";
import { openProjectView } from "./projectViews";

export type IssueHit = {
  id: string;
  kind: "issue";
  issueId: number;
  ident: string;
  title: string;
  status: IssueStatus;
  /** 项目的第一个关联目录，打开详情标签用。 */
  cwd: string;
  score: number;
};

/** listProjects 的一行：paths 是换行分隔的关联目录。 */
type ProjectRow = { id: number; paths: string | null };

/** 编号命中排最前，其次标题，再次描述；未完成的排在已完成前。没有关联目录的项目打不开详情，跳过。 */
export function searchIssueHits(issues: Issue[], projects: ProjectRow[], query: string): IssueHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const cwdOf = new Map(projects.map((p) => [p.id, p.paths?.split("\n")[0]]));
  const scored: { issue: Issue; cwd: string; score: number }[] = [];
  for (const issue of issues) {
    const cwd = cwdOf.get(issue.project_id);
    if (!cwd || !matchesIssueQuery(issue, needle)) continue;
    const byNumber = issue.ident.toLowerCase() === needle || String(issue.number) === needle.replace(/^#/, "");
    const score = (byNumber ? 100 : issue.title.toLowerCase().includes(needle) ? 50 : 10) + (isCompleted(issue.status) ? 0 : 5);
    scored.push({ issue, cwd, score });
  }
  scored.sort((a, b) => b.score - a.score || b.issue.updated_at.localeCompare(a.issue.updated_at));
  return scored.map(({ issue, cwd, score }) => ({
    id: `issue:${issue.id}`,
    kind: "issue",
    issueId: issue.id,
    ident: issue.ident,
    title: issue.title,
    status: issue.status,
    cwd,
    score,
  }));
}

export function useIssueSearchHits(open: boolean, query: string): IssueHit[] {
  const [data, setData] = useState<{ issues: Issue[]; projects: ProjectRow[] }>();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      soloyardCall<Issue[]>("listIssues", { includeSubIssues: true }),
      soloyardCall<ProjectRow[]>("listProjects"),
    ]).then(
      ([issues, projects]) => !cancelled && setData({ issues, projects }),
      () => undefined, // 数据进程没起来：搜不到 issue，不影响其他结果
    );
    return () => {
      cancelled = true;
    };
  }, [open]);
  return useMemo(() => (data ? searchIssueHits(data.issues, data.projects, query) : []), [data, query]);
}

export const openIssueHit = (hit: IssueHit) =>
  openProjectView({ cwd: hit.cwd, view: "issue", itemId: String(hit.issueId), title: `${hit.ident} ${hit.title}` });
