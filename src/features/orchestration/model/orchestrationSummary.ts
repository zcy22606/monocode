import type { OrchestrationRun, TaskStatus } from "./orchestration";
import { sessionNeedsInput, type HarnessId, type Session } from "../../sessions/model/session";
import { t } from "../../../i18n"; // IndieDesk

/** Small history projection; never includes prompts, results or credentials. */
export type OrchestrationSummary = {
  status: OrchestrationRun["status"];
  live?: boolean;
  tasks: {
    sessionId: string;
    title: string;
    harness: HarnessId;
    model: string;
    status: TaskStatus;
    needsInput?: boolean;
  }[];
};

export function summarizeOrchestration(
  run: OrchestrationRun,
  sessions: readonly Session[],
): OrchestrationSummary {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return {
    status: run.status,
    live: true,
    tasks: run.tasks.map(({ sessionId, title, harness, model, status }) => ({
      sessionId,
      title,
      harness,
      model,
      status,
      needsInput:
        !!byId.get(sessionId) && sessionNeedsInput(byId.get(sessionId)!),
    })),
  };
}

/** IndieDesk: translated; call at render. */
export function orchestrationTaskLabel(
  task: OrchestrationSummary["tasks"][number],
  summary: OrchestrationSummary,
): string {
  if (task.needsInput) return t("orchestration:taskStatus.needsInput");
  if (
    !summary.live &&
    ["running", "cancelling", "queued"].includes(task.status)
  )
    return t("orchestration:taskStatus.saved");
  if (summary.status === "paused" && task.status === "queued")
    return t("orchestration:taskStatus.paused");
  return t(`orchestration:taskStatus.${task.status}`);
}
