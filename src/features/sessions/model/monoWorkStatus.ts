import { isReadTool } from "../../../integrations/harness/core/preview";
import { t } from "../../../i18n";
import type { Block } from "./session";
import {
  isProseBlock,
  isThinkingBlock,
  isToolBlock,
  needsApproval,
  subagentFailureSummary,
  toolCategory,
  workKind,
  workSummaryLine,
  type ActivityPhaseKind,
} from "./transcriptActivity";

// Soloyard: i18n keys, translated when the status is built.
const THINKING_LABELS = [
  "sessions:monoWork.thinking",
  "sessions:monoWork.pondering",
  "sessions:monoWork.considering",
  "sessions:monoWork.workingThrough",
] as const;

export type MonoWorkStatus = {
  key: string;
  label: string;
  kind: ActivityPhaseKind;
  active: boolean;
};

/** A short status for the latest activity, stable across its streamed chunks. */
export function monoWorkStatus(
  blocks: Block[],
  active: boolean,
): MonoWorkStatus {
  if (!active) {
    return {
      key: "summary",
      label: subagentFailureSummary(blocks) ?? workSummaryLine(blocks),
      kind: workKind(blocks),
      active: false,
    };
  }
  const waiting = blocks.find(needsApproval);
  if (waiting) {
    return {
      key: `approval:${waiting.id}`,
      label: t("sessions:monoWork.waitingApproval"),
      kind: toolCategory(waiting),
      active: true,
    };
  }
  let thought = -1;
  let latest: Block | undefined;
  for (const block of blocks) {
    if (isProseBlock(block) || isThinkingBlock(block)) {
      thought += 1;
      latest = block;
    } else if (isToolBlock(block)) {
      latest = block;
    }
  }
  if (!latest || !isToolBlock(latest)) {
    return {
      key: latest?.id ?? "thinking",
      label: t(THINKING_LABELS[Math.max(0, thought) % THINKING_LABELS.length]),
      kind: "think",
      active: true,
    };
  }
  const kind = toolCategory(latest);
  const label = {
    run: t("sessions:monoWork.runningCommand"),
    edit: t("sessions:monoWork.editingFile"),
    research: isReadTool(
      latest.tool?.kind,
      latest.text || latest.tool?.title,
      latest.tool?.preview,
    )
      ? t("sessions:monoWork.readingFile")
      : t("sessions:monoWork.exploringProject"),
    agent: t("sessions:monoWork.runningAgent"),
    other: t("sessions:monoWork.usingTool"),
  }[kind];
  return { key: latest.id, label, kind, active: true };
}
