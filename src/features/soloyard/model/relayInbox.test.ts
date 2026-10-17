// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
const stopJob = vi.hoisted(() => vi.fn(async () => {}));
const mutate = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../data/api", () => ({ soloyardCall: call, mutateSoloyard: mutate }));
vi.mock("../../../integrations/harness/core/registry", () => ({ stopHarnessBackgroundJob: stopJob }));
const { useRelayInbox } = await import("./relayInbox");

const sent: unknown[] = [];
const record = (event: Event) => sent.push((event as CustomEvent).detail);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  sent.length = 0;
  window.addEventListener("soloyard:send-to-session", record);
});
afterEach(() => {
  window.removeEventListener("soloyard:send-to-session", record);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sends each message from the phone into its desktop session, and keeps polling after errors", async () => {
  call.mockRejectedValueOnce(new Error("gateway down")).mockResolvedValueOnce([
    { id: "m1", sessionId: "s1", text: "first" },
    { id: "m2", sessionId: "s2", text: "second" },
  ]).mockResolvedValue([]);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(function Host() { useRelayInbox([]); return null; })));
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  expect(sent).toEqual([]);
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  expect(sent).toEqual([{ sessionId: "s1", text: "first" }, { sessionId: "s2", text: "second" }]);
  expect(call).toHaveBeenCalledWith("relayInbox");
  act(() => root.unmount());
  const calls = call.mock.calls.length;
  await act(async () => void (await vi.advanceTimersByTimeAsync(9000)));
  expect(call.mock.calls.length).toBe(calls); // 卸载后不再取
});

it("stops a background job the phone asked to stop, with the session's harness (SOL-99)", async () => {
  call.mockReset();
  call.mockResolvedValueOnce([{ id: "m3", sessionId: "s1", text: "", stopJob: "job-7" }, { id: "m4", sessionId: "gone", text: "", stopJob: "job-8" }]).mockResolvedValue([]);
  const sessions = [{ id: "s1", harness: "claude" }] as unknown as Parameters<typeof useRelayInbox>[0];
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(function Host() { useRelayInbox(sessions); return null; })));
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  expect(stopJob).toHaveBeenCalledTimes(1);
  expect(stopJob).toHaveBeenCalledWith("claude", "s1", "job-7");
  expect(sent).toEqual([]); // 停任务不是消息，不发进会话
  act(() => root.unmount());
});

it("starts work on an issue the phone asked for: sends the prompt in a new session and links it (SOL-100)", async () => {
  call.mockReset();
  call.mockResolvedValueOnce([
    { id: "a1", sessionId: "", text: "", action: { kind: "startWork", cwd: "/app", prompt: "开始处理 SOL-1", issueId: 1, workCwd: "/app/web", model: { harness: "claude", model: "claude:opus", settings: { effort: "high" } } } },
  ]).mockResolvedValue([]);
  const started: Record<string, unknown>[] = [];
  const onStart = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    started.push(detail);
    detail.reply(detail.sessionId);
  };
  window.addEventListener("soloyard:start-work", onStart);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(function Host() { useRelayInbox([]); return null; })));
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  window.removeEventListener("soloyard:start-work", onStart);
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ cwd: "/app", prompt: "开始处理 SOL-1", workCwd: "/app/web", newWorktree: true, send: true, seed: { harness: "claude", model: "claude:opus", modelSettings: { effort: "high" } } });
  expect(mutate).toHaveBeenCalledWith("linkSession", started[0].sessionId, "issue", "1");
  expect(sent).toEqual([]);
  act(() => root.unmount());
});
