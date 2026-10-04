/**
 * Soloyard：把会话的关联对象放进输入框的 @ 候选（和底座的 @note/… 同一套机制）。
 * 选中后插入 @link/SOL-5 这样的引用；发送时由 sessionContext.ts 换成内容。
 */
import { useMemo } from "react";
import type { RankedFile } from "../../files/model/fileIndex";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { useSoloyard } from "../data/api";

type MentionLink = { kind: string; target: string; code: string | null; title: string; mention: string; missing?: boolean };

const PATH_PREFIX = "soloyard:";

export const NO_SOLOYARD_MENTIONS: ProjectFile[] = [];

export const isSoloyardMentionPath = (path: string) => path.startsWith(PATH_PREFIX);

export function linksAsMentionFiles(links: MentionLink[]): ProjectFile[] {
  return links
    .filter((l) => !l.missing)
    .map((l) => ({
      name: l.code ? `${l.code} ${l.title}` : l.title,
      path: `${PATH_PREFIX}${l.kind}:${l.target}`,
      relative: l.mention,
    }));
}

/** 没输入时全列出来，输入了按标题 / 引用名模糊匹配。 */
export function rankSoloyardMentions(files: ProjectFile[], query: string): RankedFile[] {
  const needle = query.trim();
  if (!needle) return files.map((file) => ({ ...file, score: 0, positions: [] }));
  return files
    .flatMap((file): RankedFile[] => {
      const hit = fuzzyMatch(needle, file.name) ?? fuzzyMatch(needle, file.relative);
      // ponytail: 不高亮——候选框按路径算高亮位置，对不上我们的标题
      return hit ? [{ ...file, score: hit.score, positions: [] }] : [];
    })
    .sort((a, b) => b.score - a.score);
}

export function useSoloyardMentions(sessionId: string): ProjectFile[] {
  const { data } = useSoloyard<MentionLink[]>("sessionLinks", sessionId);
  return useMemo(() => (data?.length ? linksAsMentionFiles(data) : NO_SOLOYARD_MENTIONS), [data]);
}
