// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostSessionRow } from "../../model/hostSessions";

const api = vi.hoisted(() => ({ rows: [] as unknown[], mutate: vi.fn() }));
vi.mock("../../data/api", () => ({
  useSoloyard: () => ({ data: api.rows, reload: () => {} }),
  mutateSoloyard: api.mutate,
}));

const { HostSessions } = await import("./HostSessions");

const row = (id: string, patch: Partial<HostSessionRow> = {}): HostSessionRow => ({
  id, title: `Session ${id}`, harness: "claude", model: "claude:opus", status: "idle", needsInput: false, updatedAt: Date.now(), ...patch,
});
const taken = () => ({
  session: {
    harness: "claude", model: "claude:opus", modelSettings: {}, runtimeMode: "supervised", title: "Fix login",
    providerSessionId: "p-1", blocks: [{ id: "u1", role: "user", text: "fix login" }],
  },
});

let container: HTMLDivElement;
let root: Root;
const events: { name: string; detail: Record<string, unknown> }[] = [];
// App 的监听：开新会话立刻回 id
const record = (event: Event) => {
  const { detail } = event as CustomEvent<Record<string, unknown> & { reply: (value?: string) => void }>;
  events.push({ name: event.type, detail });
  detail.reply(detail.sessionId as string);
};
const flush = () => act(async () => {});
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.rows = [];
  api.mutate.mockReset();
  events.length = 0;
  window.addEventListener("soloyard:start-work", record);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener("soloyard:start-work", record);
  vi.unstubAllGlobals();
});

it("shows nothing without host sessions", () => {
  act(() => root.render(createElement(HostSessions, { cwd: "/app" })));
  expect(container.textContent).toBe("");
});

it("takes a phone session back into a new local session that resumes its conversation", async () => {
  api.rows = [row("a"), row("b", { status: "running" })];
  api.mutate.mockResolvedValue(taken());
  act(() => root.render(createElement(HostSessions, { cwd: "/app" })));
  expect(container.textContent).toContain("On your phone");
  expect(button("Session b").disabled).toBe(true); // 主机上还在跑的拿不回来

  click(button("Session a"));
  await flush();
  expect(api.mutate).toHaveBeenCalledWith("takeHostSession", "a");
  expect(events.map((e) => e.name)).toEqual(["soloyard:start-work"]);
  const start = events[0].detail as { cwd: string; prompt: string; seed: Record<string, unknown> };
  expect(start.cwd).toBe("/app");
  expect(start.prompt).toBe("");
  expect(start.seed).toMatchObject({ providerSessionId: "p-1", title: "Fix login", harness: "claude", blocks: [{ id: "u1" }] });
});

it("shows why a take failed", async () => {
  api.rows = [row("a")];
  api.mutate.mockRejectedValue(new Error("This session is still running on the host."));
  act(() => root.render(createElement(HostSessions, { cwd: "/app" })));
  click(button("Session a"));
  await flush();
  expect(container.textContent).toContain("Couldn't take it back: This session is still running on the host.");
  expect(events).toEqual([]);
});

