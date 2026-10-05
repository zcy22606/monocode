// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flattenGrouped, groupHits, mergeHits } from "../../search/model/appSearch";
import type { Issue } from "./issues";
import { openIssueHit, searchIssueHits } from "./issueSearch";

const issue = (id: number, projectId: number, patch: Partial<Issue>): Issue => ({
  id, project_id: projectId, number: id, ident: `${projectId === 1 ? "SOL" : "APP"}-${id}`, title: `t${id}`, body_md: "",
  status: "todo", priority: 0, labels: [], created_at: "2026-10-01", updated_at: "2026-10-01", completed_at: null,
  version: 1, children: 0, children_done: 0, sessions: 0, ...patch,
});

const projects = [
  { id: 1, paths: "/p/sol\n/p/sol-docs" },
  { id: 2, paths: null },
];
const issues = [
  issue(1, 1, { title: "search box", status: "done" }),
  issue(2, 1, { title: "kanban", body_md: "needs search" }),
  issue(3, 1, { title: "search everywhere", updated_at: "2026-10-03" }),
  issue(17, 1, { title: "unrelated" }),
  issue(4, 2, { title: "search in a project without a folder" }),
];

describe("searchIssueHits", () => {
  it("ranks number > title > description, open before done, skips projects without a folder", () => {
    const hits = searchIssueHits(issues, projects, "search");
    expect(hits.map((h) => h.ident)).toEqual(["SOL-3", "SOL-1", "SOL-2"]);
    expect(hits[0]).toMatchObject({ kind: "issue", issueId: 3, cwd: "/p/sol", status: "todo" });
    expect(searchIssueHits(issues, projects, "sol-17").map((h) => h.ident)).toEqual(["SOL-17"]);
    expect(searchIssueHits(issues, projects, "  ")).toEqual([]);
  });

  it("shows up in the All and Issues scopes of global search, not in the others", () => {
    const hits = mergeHits(searchIssueHits(issues, projects, "search"));
    expect(flattenGrouped(groupHits(hits, "all"))).toHaveLength(3);
    expect(flattenGrouped(groupHits(hits, "issues")).map((h) => h.id)).toEqual(["issue:3", "issue:1", "issue:2"]);
    expect(flattenGrouped(groupHits(hits, "files"))).toEqual([]);
  });

  it("opens the issue detail tab in the issue's project", () => {
    const listener = vi.fn();
    window.addEventListener("soloyard:open-project-view", listener);
    openIssueHit(searchIssueHits(issues, projects, "17")[0]);
    window.removeEventListener("soloyard:open-project-view", listener);
    expect(listener.mock.calls[0][0].detail).toEqual({ cwd: "/p/sol", view: "issue", itemId: "17", title: "SOL-17 unrelated" });
  });
});
