import { describe, expect, it } from "vitest";
import { matchesRepoFilter, sessionRepo } from "./repoFilter";
import type { ProjectRepos } from "./repos";

const info = {
  project: { id: 1, key: "OPE", name: "openroboto", instructions: "", root: "/ws", rootIsRepo: false },
  repos: [
    { id: 1, path: "/ws/backend", name: "backend", description: "", branch: "main", missing: false, worktrees: [{ path: "/ws/wt-rotate", name: "wt-rotate", branch: "feat/x" }] },
    { id: 2, path: "/ws/web", name: "web", description: "", branch: "main", missing: false, worktrees: [] },
  ],
} satisfies ProjectRepos;

describe("repo filter", () => {
  it("places a session by its working copy: root, a repo, or the repo of its worktree", () => {
    expect(sessionRepo(info, {})).toBe("root");
    expect(sessionRepo(info, { worktreeCwd: "/ws" })).toBe("root");
    expect(sessionRepo(info, { worktreeCwd: "/ws/web/src" })).toBe("/ws/web");
    expect(sessionRepo(info, { worktreeCwd: "/ws/wt-rotate" })).toBe("/ws/backend");
  });

  it("lets everything through without a filter or before repos load", () => {
    expect(matchesRepoFilter(info, undefined, { worktreeCwd: "/ws/web" })).toBe(true);
    expect(matchesRepoFilter(undefined, "/ws/web", {})).toBe(true);
    expect(matchesRepoFilter(info, "/ws/backend", { worktreeCwd: "/ws/wt-rotate" })).toBe(true);
    expect(matchesRepoFilter(info, "/ws/backend", { worktreeCwd: "/ws/web" })).toBe(false);
    expect(matchesRepoFilter(info, "root", {})).toBe(true);
  });
});
