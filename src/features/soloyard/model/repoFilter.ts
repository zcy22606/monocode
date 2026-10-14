/**
 * Soloyard：多仓库项目的会话列表按仓库筛选。侧栏项目下的仓库行和会话列表上方的筛选标签共用这一份状态，
 * 放模块里（同 projectViews 的高亮），上游的 ProjectRail / Sidebar 只多一两行。
 */
import { useSyncExternalStore } from "react";
import { locateWorkDir, useProjectRepos, type ProjectRepos } from "./repos";

/** "root" = 在根目录跑的会话；否则是成员仓库的路径。 */
export type RepoFilter = "root" | string;

const filters = new Map<string, RepoFilter>();
const listeners = new Set<() => void>();
const key = (root: string) => root.replace(/\/+$/, "");

export function setRepoFilter(root: string, filter: RepoFilter | null) {
  if (filter === null) filters.delete(key(root));
  else filters.set(key(root), filter);
  listeners.forEach((l) => l());
}

export function useRepoFilter(root: string | undefined): RepoFilter | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (root ? filters.get(key(root)) : undefined),
  );
}

/** 会话在哪个成员仓库（工作目录落在仓库或它的工作树里）；在根目录为 "root"。 */
export function sessionRepo(info: ProjectRepos, session: { worktreeCwd?: string }): RepoFilter {
  return locateWorkDir(info, session.worktreeCwd)?.repo.path ?? "root";
}

/** 会话列表的筛选条件；没选筛选或还没取到仓库信息时都放行。 */
export function matchesRepoFilter(
  info: ProjectRepos | null | undefined,
  filter: RepoFilter | undefined,
  session: { worktreeCwd?: string },
): boolean {
  if (!filter || !info?.repos?.length) return true;
  return sessionRepo(info, session) === filter;
}

/**
 * 侧栏选了根目录或某个仓库时，文件 / 更改 / ⌘P 都看那里：当前的会话或文件已经在它里面（含它的工作树）就不动，
 * 否则换成它（根目录 = 项目文件夹）。没选、或选的仓库已经移出 / 不在了，照旧。
 */
export function repoBrowseCwd(
  info: ProjectRepos | null | undefined,
  filter: RepoFilter | undefined,
  root: string | undefined,
  cwd: string,
): string {
  if (!filter || !root || !info?.repos?.length) return cwd;
  if (filter !== "root" && !info.repos.some((r) => r.path === filter && !r.missing)) return cwd;
  if (sessionRepo(info, { worktreeCwd: cwd }) === filter) return cwd;
  return filter === "root" ? root : filter;
}

export const useRepoBrowseCwd = (root: string | undefined, cwd: string) =>
  repoBrowseCwd(useProjectRepos(root), useRepoFilter(root), root, cwd);

/** 各仓库的会话数：会话列表（Sidebar）算好放这里，侧栏项目下的仓库行显示在右边。 */
const counts = new Map<string, Map<RepoFilter, number>>();
const EMPTY = new Map<RepoFilter, number>();

export function publishRepoCounts(root: string, next: Map<RepoFilter, number>) {
  const prev = counts.get(key(root));
  if (prev && prev.size === next.size && [...next].every(([k, n]) => prev.get(k) === n)) return;
  counts.set(key(root), next);
  listeners.forEach((l) => l());
}

export function useRepoCounts(root: string): Map<RepoFilter, number> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => counts.get(key(root)) ?? EMPTY,
  );
}
