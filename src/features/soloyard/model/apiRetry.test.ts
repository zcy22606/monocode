import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { newSession } from "../../sessions/model/session";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("../../../integrations/harness/core/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { cancelClaudeTurn, sendClaudeTurn, stopClaudeSession, __claudeTestReset } = await import(
  "../../../integrations/harness/providers/claude/claude"
);

const emit = (rec: Record<string, unknown>) => onLine!(JSON.stringify(rec));

async function until(pred: () => boolean) {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
}

async function startTurn() {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "hi",
    attachments: [],
    onEvent: (event) => events.push(event),
  });
  await until(() => sent.some((line) => line.includes('"initialize"')));
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({ type: "control_response", response: { subtype: "success", request_id: "monocode_1" } });
  await until(() => sent.some((line) => JSON.parse(line).type === "user"));
  return { events, turn };
}

/** 照 Claude Code 2.1.296 连接被重置时真实输出的那一行。 */
const retry = (attempt: number, extra: Record<string, unknown> = {}) => ({
  type: "system",
  subtype: "api_retry",
  attempt,
  max_retries: 10,
  retry_delay_ms: 573,
  error_status: null,
  error: "unknown",
  session_id: "sess_1",
  ...extra,
});

const statusTexts = (events: HarnessEvent[]) => events.flatMap((e) => (e.type === "status" ? [e.text] : []));
const systemRows = (events: HarnessEvent[]) =>
  events.reduce(applyHarnessEvent, newSession("claude", "/repo")).blocks.filter((b) => b.role === "system");

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  __claudeTestReset();
});

afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("Claude API retries", () => {
  it("keeps one row up to date while Claude retries and drops it once the answer streams", async () => {
    const { events, turn } = await startTurn();
    emit(retry(1));
    emit(retry(2));
    expect(systemRows(events).map((b) => b.text)).toEqual(["Connection error · retrying (2/10)…"]);

    emit({
      type: "stream_event",
      session_id: "sess_1",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(statusTexts(events)).toEqual([
      "Connection error · retrying (1/10)…",
      "Connection error · retrying (2/10)…",
      "",
    ]);
    expect(systemRows(events)).toEqual([]);
  });

  it("drops the row when the user stops mid-retry", async () => {
    const { events, turn } = await startTurn();
    emit(retry(3));
    expect(systemRows(events)).toHaveLength(1);
    await cancelClaudeTurn("s1");
    await turn;
    expect(systemRows(events)).toEqual([]);
  });

  it("says what went wrong", async () => {
    const { events } = await startTurn();
    emit(retry(1, { error_status: 429, error: "rate_limit" }));
    emit(retry(2, { error_status: 529, error: "overloaded" }));
    emit(retry(3, { error_status: 500, error: "server_error" }));
    emit(retry(1, { max_retries: 1, no_response: { waited_ms: 205000, retry_wait_ms: 599000 } }));
    expect(statusTexts(events)).toEqual([
      "Rate limited · retrying (1/10)…",
      "API overloaded · retrying (2/10)…",
      "API error 500 · retrying (3/10)…",
      "No response from the API · retrying (1/1)…",
    ]);
  });
});
