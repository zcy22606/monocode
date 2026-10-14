import { describe, expect, it } from "vitest";
import { matchesRepoFilter, repoBrowseCwd, sessionRepo } from "./repoFilter";
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

  it("points Files at the picked repo or root unless the current session is already there", () => {
    expect(repoBrowseCwd(info, undefined, "/ws", "/ws/web")).toBe("/ws/web");
    expect(repoBrowseCwd(info, "/ws/web", "/ws", "/ws")).toBe("/ws/web");
    expect(repoBrowseCwd(info, "/ws/backend", "/ws", "/ws/wt-rotate")).toBe("/ws/wt-rotate");
    expect(repoBrowseCwd(info, "root", "/ws", "/ws/wt-rotate")).toBe("/ws");
    expect(repoBrowseCwd(info, "root", "/ws", "/ws")).toBe("/ws");
    expect(repoBrowseCwd(info, "/ws/gone", "/ws", "/ws")).toBe("/ws");
  });
});
