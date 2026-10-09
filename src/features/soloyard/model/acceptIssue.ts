/**
 * Soloyard：验收通过 = 代码进主干。issue 在工作树里做的，先把分支合进仓库主检出（soloyard/core/src/merge.ts），
 * 合上了再改成 done 并留一条合并记录；合不了（没提交、主检出不干净、冲突）不改状态，把原因告诉用户。
 */
import { t } from "../../../i18n";
import { mutateSoloyard, soloyardCall } from "../data/api";
import { repoName } from "./issues";

export type IssueBranch = { repo: string; worktree: string; branch: string; target: string; ahead: number; dirty: string[] };
type Where = { repo: string; branch: string; target: string };
export type MergeResult =
  | ({ merged: true; commit: string } & Where)
  | ({ merged: false; reason: "nothing" | "already" } & Partial<Where>)
  | ({ merged: false; reason: "dirty-worktree" | "dirty-main" | "conflict" | "no-target" | "failed"; files: string[]; message?: string } & Where);

const failed = (r: MergeResult): r is Extract<MergeResult, { files: string[] }> => !r.merged && r.reason !== "nothing" && r.reason !== "already";

/** 合不了的原因（给用户看的一句话）。 */
export function mergeFailureText(r: Extract<MergeResult, { files: string[] }>): string {
  const files = r.files.slice(0, 5).join(t("soloyard:prompt.listSeparator")) + (r.files.length > 5 ? " …" : "");
  const repo = repoName(r.repo);
  switch (r.reason) {
    case "dirty-worktree":
      return t("soloyard:merge.dirtyWorktree", { branch: r.branch, count: r.files.length, files });
    case "dirty-main":
      return t("soloyard:merge.dirtyMain", { repo, files });
    case "conflict":
      return t("soloyard:merge.conflict", { branch: r.branch, repo, target: r.target, files });
    case "no-target":
      return t("soloyard:merge.noTarget", { repo });
    default:
      return t("soloyard:merge.failed", { message: r.message ?? "" });
  }
}

/** 合并（如果有要合的）→ 失败返回原因；成功留评论。不改状态，调用方决定怎么改（单个 / 批量）。 */
export async function mergeBeforeAccept(issueId: number): Promise<string | null> {
  const result = await soloyardCall<MergeResult>("mergeIssueBranch", issueId);
  if (failed(result)) return mergeFailureText(result);
  if (result.merged) {
    await mutateSoloyard("addComment", issueId, t("soloyard:merge.comment", { branch: result.branch, repo: repoName(result.repo), target: result.target, commit: result.commit }));
  }
  return null;
}

/** 详情页的「通过」：先合并，合上了再改成 done。返回合不了的原因，成功返回 null。 */
export async function acceptIssue(issueId: number): Promise<string | null> {
  const error = await mergeBeforeAccept(issueId);
  if (error) return error;
  await mutateSoloyard("updateIssue", issueId, { status: "done" });
  return null;
}
