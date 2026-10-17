// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../../sessions/model/session";

const call = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../data/api", () => ({ soloyardCall: call }));
const { currentTurn, useLiveMirror } = await import("./liveMirror");

const session = (blocks: Partial<Block>[], busy: boolean) =>
  ({ id: "s1", busy, blocks: blocks.map((b, i) => ({ id: `b${i}`, role: "assistant", text: "", ...b })) }) as unknown as Session;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  call.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("takes the running turn from the last sent user message and drops image data", () => {
  const live = currentTurn(
    session([{ role: "user", text: "old" }, { text: "done" }, { role: "user", text: "new", attachments: [{ id: "i", name: "a.png", kind: "image", mimeType: "image/png", size: 1, data: "AAAA" }] }, { text: "work", streaming: true }, { role: "user", text: "draft", draft: true }], true),
  );
  expect(live.from).toBe("b2");
  expect(live.blocks.map((b) => b.id)).toEqual(["b2", "b3", "b4"]);
  expect(live.blocks[0].attachments?.[0]).not.toHaveProperty("data");
});

it("pushes a running session at most once a second, then once more when it finishes", async () => {
  const root = createRoot(document.createElement("div"));
  function Host({ s }: { s: Session }) {
    useLiveMirror([s]);
    return null;
  }
  const render = (s: Session) => act(() => root.render(createElement(Host, { s })));
  render(session([{ role: "user", text: "go" }, { text: "a", streaming: true }], true));
  expect(call).toHaveBeenCalledTimes(1);
  render(session([{ role: "user", text: "go" }, { text: "ab", streaming: true }], true));
  render(session([{ role: "user", text: "go" }, { text: "abc", streaming: true }], true));
  expect(call).toHaveBeenCalledTimes(1); // 这一秒里的变化攒着
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(call).toHaveBeenCalledTimes(2);
  expect((call.mock.calls[1] as unknown[])[2]).toMatchObject({ busy: true, blocks: [{ text: "go" }, { text: "abc" }] });
  render(session([{ role: "user", text: "go" }, { text: "abc", streaming: true }], true));
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  expect(call).toHaveBeenCalledTimes(2); // 没变化不推
  render(session([{ role: "user", text: "go", durationMs: 3000 }, { text: "abc!" }], false));
  expect(call).toHaveBeenCalledTimes(3);
  expect((call.mock.calls[2] as unknown[])[2]).toMatchObject({ busy: false });
  render(session([{ role: "user", text: "go", durationMs: 3000 }, { text: "abc!" }], false));
  await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
  expect(call).toHaveBeenCalledTimes(3); // 跑完的不再管
  act(() => root.unmount());
});

it("pushes background jobs when they change, keeps them alive every 30s, and clears them once (SOL-99)", async () => {
  const root = createRoot(document.createElement("div"));
  function Host({ s }: { s: Session }) {
    useLiveMirror([s]);
    return null;
  }
  const withJobs = (jobs: { id: string; title: string; command?: string; startedAt: number }[]) =>
    ({ ...session([{ role: "user", text: "go", durationMs: 5 }], false), backgroundJobs: jobs }) as Session;
  const render = (s: Session) => act(() => root.render(createElement(Host, { s })));
  const jobPushes = () => call.mock.calls.filter((c) => (c as unknown[])[0] === "jobsPush");

  render(withJobs([]));
  expect(jobPushes()).toEqual([]); // 从来没有任务：不推
  const job = { id: "j1", title: "sleep 600", command: "sleep 600", startedAt: 1 };
  render(withJobs([job]));
  expect(jobPushes()).toEqual([["jobsPush", "s1", [job]]]);
  render(withJobs([job])); // 没变：不推
  expect(jobPushes().length).toBe(1);
  const named = { ...job, command: "sleep 600 # later" };
  render(withJobs([named])); // 命令后报上来：再推
  expect(jobPushes().length).toBe(2);
  render(withJobs([job]));
  expect(jobPushes().length).toBe(3);
  await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
  expect(jobPushes().length).toBe(4); // 续一次
  render(withJobs([]));
  expect(jobPushes()[jobPushes().length - 1]).toEqual(["jobsPush", "s1", []]);
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  expect(jobPushes().length).toBe(5); // 空了以后不再续
  act(() => root.unmount());
});
