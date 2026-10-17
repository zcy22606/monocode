// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ status: undefined as unknown, mutate: vi.fn(), reload: vi.fn() }));
vi.mock("../data/api", () => ({
  useSoloyard: () => ({ data: api.status, reload: api.reload }),
  mutateSoloyard: api.mutate,
}));

const { SoloyardSyncSettings } = await import("./SoloyardSyncSettings");

let container: HTMLDivElement;
let root: Root;
const render = () => act(() => root.render(createElement(SoloyardSyncSettings)));
const flush = () => act(async () => {});
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    // React 只认原生 setter 改的值
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.mutate.mockReset();
  api.reload.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("connects with the gateway address and the desktop credential", async () => {
  api.status = { connected: false, url: null, host: null, machine: "MacBook", pushedAt: null, error: null, sessions: 0 };
  render();
  expect(container.textContent).toContain("Phone sync");
  const [url, token] = [...container.querySelectorAll("input")];
  expect(token.type).toBe("password");
  expect(button("Connect").disabled).toBe(true);
  type(url, "http://100.1.2.3:3775");
  type(token, "t".repeat(43));
  api.mutate.mockRejectedValueOnce(new Error("This credential is for a phone. Pair one with --desktop on the host."));
  await act(async () => button("Connect").click());
  expect(api.mutate).toHaveBeenCalledWith("connectSync", "http://100.1.2.3:3775", "t".repeat(43));
  expect(container.textContent).toContain("This credential is for a phone");
  expect(token.value).toBe("t".repeat(43)); // 出错不清空，改一下重试
  api.mutate.mockResolvedValueOnce({ host: "mini" });
  await act(async () => button("Connect").click());
  await flush();
  expect(token.value).toBe("");
  expect(api.reload).toHaveBeenCalled();
});

it("shows what is synced and disconnects", async () => {
  api.status = { connected: true, url: "http://100.1.2.3:3775", host: "mini", machine: "MacBook", pushedAt: Date.now() - 60_000, error: null, sessions: 12 };
  render();
  expect(container.textContent).toContain("Connected to mini");
  expect(container.textContent).toContain("12 sessions synced");
  expect(container.textContent).toContain("http://100.1.2.3:3775 · MacBook");
  await act(async () => button("Disconnect").click());
  expect(api.mutate).toHaveBeenCalledWith("disconnectSync");
});

it("surfaces a sync error", () => {
  api.status = { connected: true, url: "http://100.1.2.3:3775", host: "mini", machine: "MacBook", pushedAt: null, error: "HTTP 502", sessions: 0 };
  render();
  expect(container.textContent).toContain("Sync failed: HTTP 502");
});
