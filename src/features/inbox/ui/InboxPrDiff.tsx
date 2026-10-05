import { useMemo } from "react";
import type { GithubPrDiff } from "../model/githubTasks";
import { mergePrDiff, parsePrPatch, type PrDiffFile } from "../../source-control/model/prDiff";
import { blocksFromLines, type UnifiedLine } from "../../source-control/model/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "../../source-control/ui/UnifiedDiffView";
import { useTranslation } from "../../../i18n";

type Props = {
  diff: GithubPrDiff;
  /** When true, show the whole file (no fold rows). */
  fullFile?: boolean;
  /** File to open and scroll to, such as one picked from the summary. */
  focusPath?: string;
};

export function InboxPrDiff({ diff, fullFile = false, focusPath }: Props) {
  const { t } = useTranslation("inbox");
  const files = useMemo(() => {
    const parsed = mergePrDiff(diff.files, parsePrPatch(diff.patch));
    const context = fullFile ? Number.POSITIVE_INFINITY : undefined;
    return parsed.map((file) =>
      toModel(file, diff.truncated, context, {
        tooLarge: t("diff.tooLarge"),
        noTextual: t("diff.noTextual"),
      }),
    );
  }, [diff, fullFile, t]);

  return (
    <UnifiedDiffView
      files={files}
      truncated={diff.truncated}
      totals={{ additions: diff.additions, deletions: diff.deletions }}
      fill={false}
      fileLayout="cards"
      initialExpansion="first"
      focusPath={focusPath}
    />
  );
}

function toModel(
  file: PrDiffFile,
  truncated: boolean,
  context: number | undefined,
  messages: { tooLarge: string; noTextual: string },
): UnifiedDiffFileModel {
  const lines = file.lines.map(toUnifiedLine);
  return {
    id: file.path,
    path: file.path,
    label:
      file.status === "renamed" && file.previousPath
        ? `${file.previousPath} → ${file.path}`
        : file.path,
    binary: file.binary,
    emptyMessage:
      !file.binary && file.lines.length === 0
        ? truncated
          ? messages.tooLarge
          : messages.noTextual
        : undefined,
    additions: file.additions,
    deletions: file.deletions,
    blocks: blocksFromLines(lines, context),
  };
}

function toUnifiedLine(line: PrDiffFile["lines"][number]): UnifiedLine {
  return {
    kind: line.kind,
    text: line.text,
    oldNumber: line.oldNumber,
    newNumber: line.newNumber,
  };
}
