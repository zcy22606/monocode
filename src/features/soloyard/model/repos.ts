/**
 * Soloyard：多仓库项目在前端的类型和读法（数据在 soloyard/core/src/repos.ts）。
 * 在成员仓库里干活的会话：cwd 是项目根目录，worktreeCwd 是实际的仓库或它的工作树。
 */
import { useMemo } from "react";
import { useSoloyard } from "../data/api";

export type Worktree = { path: string; name: string; branch: string | null };
export type RepoInfo = { id: number; path: string; name: string; description: string; branch: string | null; worktrees: Worktree[]; missing: boolean };
export type ProjectRepos = {
  project: { id: number; key: string; name: string; instructions: string; root: string | null; rootIsRepo: boolean };
  repos: RepoInfo[];
};
export type RepoCandidate = { path: string; name: string; branch: string | null };

/** 路径所在项目的仓库全貌；不在项目里为 null，还没取到为 undefined。 */
export const useProjectRepos = (cwd: string | undefined) => useSoloyard<ProjectRepos | null>("projectRepos", cwd).data;

/** 有成员仓库的项目：输入框顶栏换成「在哪干活」，不再显示根目录的分支。 */
export const useIsMultiRepo = (cwd: string | undefined) => !!useProjectRepos(cwd)?.repos?.length;

const inside = (path: string, root: string) => path === root || path.startsWith(root + "/");

/** 工作目录落在哪个成员仓库（仓库本身、子目录或它的工作树）；在根目录为 null。 */
export function locateWorkDir(info: ProjectRepos, workCwd: string | undefined): { repo: RepoInfo; worktree?: Worktree } | null {
  if (!workCwd) return null;
  const cwd = workCwd.replace(/\/+$/, "");
  for (const repo of info.repos) {
    if (inside(cwd, repo.path)) return { repo };
    const worktree = repo.worktrees.find((w) => inside(cwd, w.path));
    if (worktree) return { repo, worktree };
  }
  return null;
}

/** 成员仓库在根目录下时显示相对路径，在别处显示完整路径（家目录缩成 ~）。 */
export function displayPath(path: string, root: string | null, home?: string): string {
  if (root && path.startsWith(root + "/")) return path.slice(root.length + 1);
  return home && path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

/** 侧栏项目列表藏掉成员仓库：它们从父项目进，会话也归在父项目下。 */
export function useWithoutMemberRepos<T extends { path: string }>(items: T[]): T[] {
  const { data: members } = useSoloyard<string[]>("memberRepoPaths");
  return useMemo(() => {
    if (!members?.length) return items;
    const hidden = new Set(members.map((p) => p.replace(/\/+$/, "")));
    return items.filter((item) => !hidden.has(item.path.replace(/\/+$/, "")));
  }, [items, members]);
}
