// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Issue } from "./issues";
import { DEFAULT_VIEW, ISSUE_FIELDS, applyView, loadIssueView, matchesIssueQuery, saveIssueView } from "./issueView";

const issue = (number: number, patch: Partial<Issue>): Issue => ({
  id: number, project_id: 1, number, ident: `APP-${number}`, title: `t${number}`, body_md: "", status: "todo",
  priority: 0, labels: [], created_at: `2026-10-0${number}`, updated_at: `2026-10-0${number}`, completed_at: null,
  version: 1, children: 0, children_done: 0, sessions: 0, repo_path: null, ...patch,
});

const issues = [
  issue(1, { status: "todo", priority: 3, labels: ["ui"] }),
  issue(2, { status: "in_progress", priority: 1 }),
  issue(3, { status: "done", priority: 0, labels: ["ui", "api"] }),
  issue(4, { status: "todo", priority: 1 }),
];

describe("applyView", () => {
  it("groups by status in workflow order and sorts by priority with no-priority last", () => {
    const groups = applyView(issues, DEFAULT_VIEW);
    expect(groups.map((g) => g.key)).toEqual(["todo", "in_progress", "done"]);
    expect(groups[0].issues.map((i) => i.number)).toEqual([4, 1]);
  });

  it("hides completed issues and their groups, keeps empty groups only on request", () => {
    expect(applyView(issues, { ...DEFAULT_VIEW, showCompleted: false }).map((g) => g.key)).toEqual(["todo", "in_progress"]);
    const withEmpty = applyView(issues, { ...DEFAULT_VIEW, showCompleted: false, showEmptyGroups: true });
    expect(withEmpty.map((g) => g.key)).toEqual(["backlog", "todo", "in_progress", "in_review"]);
  });

  it("filters with any-of semantics and puts multi-label issues in every label group", () => {
    const urgent = applyView(issues, { ...DEFAULT_VIEW, groupBy: null, filters: [{ field: "priority", values: ["1"] }] });
    expect(urgent[0].issues.map((i) => i.number)).toEqual([2, 4]);
    const byLabel = applyView(issues, { ...DEFAULT_VIEW, groupBy: "labels" });
    expect(byLabel.map((g) => [g.key, g.issues.map((i) => i.number)])).toEqual([
      ["api", [3]],
      ["ui", [1, 3]],
      ["__none__", [2, 4]],
    ]);
  });

  it("dragging into a group produces the field's patch", () => {
    expect(ISSUE_FIELDS.status.group!.patchFor!("in_review")).toEqual({ status: "in_review" });
    expect(ISSUE_FIELDS.labels.group!.patchFor!("api", issues[0])).toEqual({ labels: ["ui", "api"] });
    expect(ISSUE_FIELDS.labels.group!.patchFor!("__none__", issues[2])).toEqual({ labels: [] });
  });
});

describe("issue search", () => {
  it("matches the exact number or ident, and title / description case-insensitively", () => {
    const one = issue(17, { title: "Search Box", body_md: "Filter by keyword" });
    for (const q of ["17", "#17", "app-17", " APP-17 ", "search", "KEYWORD", ""]) expect(matchesIssueQuery(one, q)).toBe(true);
    for (const q of ["1", "APP-1", "app", "board"]) expect(matchesIssueQuery(one, q)).toBe(false);
  });

  it("stacks with filters and narrows every group (list and board share applyView)", () => {
    const withText = [...issues.slice(0, 3), issue(4, { status: "todo", priority: 1, title: "fix ui crash" })];
    const groups = applyView(withText, { ...DEFAULT_VIEW, filters: [{ field: "labels", values: ["ui"] }] }, "t");
    expect(groups.map((g) => [g.key, g.issues.map((i) => i.number)])).toEqual([["todo", [1]], ["done", [3]]]);
    expect(applyView(withText, DEFAULT_VIEW, "crash").flatMap((g) => g.issues.map((i) => i.number))).toEqual([4]);
    expect(applyView(withText, { ...DEFAULT_VIEW, layout: "board" }, "3").flatMap((g) => g.issues.map((i) => i.number))).toEqual([3]);
  });
});

describe("issue view persistence", () => {
  it("merges saved config with defaults and drops unknown fields", () => {
    localStorage.setItem("soloyard.issueView.7", JSON.stringify({ layout: "board", groupBy: "assignee", properties: ["id", "nope"] }));
    const view = loadIssueView(7);
    expect(view.layout).toBe("board");
    expect(view.groupBy).toBe("status");
    expect(view.properties).toEqual(["id"]);
    saveIssueView(7, { ...view, groupBy: null });
    expect(loadIssueView(7).groupBy).toBeNull();
  });
});

describe("repo field", () => {
  const repoIssues = [issue(1, { repo_path: "/ws/web" }), issue(2, { repo_path: "/ws/backend" }), issue(3, {}), issue(4, { repo_path: "/ws/backend" })];
  it("groups by member repo (by name) with the project root last; moving into a group sets or clears the repo", () => {
    const groups = applyView(repoIssues, { ...DEFAULT_VIEW, groupBy: "repo", orderBy: "id" });
    expect(groups.map((g) => [g.label, g.issues.map((i) => i.number)])).toEqual([
      ["backend", [2, 4]],
      ["web", [1]],
      ["Project root", [3]],
    ]);
    expect(ISSUE_FIELDS.repo.group!.patchFor!("/ws/web")).toEqual({ repo_path: "/ws/web" });
    expect(ISSUE_FIELDS.repo.group!.patchFor!("__root__")).toEqual({ repo_path: null });
  });
  it("filters by repo, including issues at the project root", () => {
    const view = { ...DEFAULT_VIEW, groupBy: null, orderBy: "id" as const, filters: [{ field: "repo" as const, values: ["/ws/backend", "__root__"] }] };
    expect(applyView(repoIssues, view)[0].issues.map((i) => i.number)).toEqual([2, 3, 4]);
  });
});
