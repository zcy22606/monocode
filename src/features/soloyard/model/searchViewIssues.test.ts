// @vitest-environment happy-dom
// Soloyard：全局搜索（底座 SearchView）里搜得到 issue。用 .ts，项目的测试 glob 不收 .test.tsx。
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SearchView } from "../../search/ui/SearchView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../../platform/tauri/platform", async (load) => ({ ...(await load<object>()), IS_MAC: true }));

it("finds an issue by ident in the All scope and opens it", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd !== "soloyard_call") return null;
    const { method } = args as { method: string };
    if (method === "listProjects") return [{ id: 1, paths: "/p/sol" }];
    if (method === "listIssues")
      return [{ id: 13, project_id: 1, number: 13, ident: "SOL-13", title: "Docs page", body_md: "", status: "todo", updated_at: "2026-10-01" }];
    return null;
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const noop = () => undefined;
  await act(async () => {
    root.render(createElement(SearchView, { open: true, cwd: "~", recents: [], history: [], sessions: [], onClose: noop, onOpenFile: noop, onOpenSession: noop, onOpenProject: noop }));
  });
  const input = host.querySelector("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "sol-13");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => new Promise((r) => setTimeout(r, 300)));
  const option = [...host.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes("SOL-13"));
  expect(option?.textContent).toContain("Docs page");
  const opened = vi.fn();
  window.addEventListener("soloyard:open-project-view", opened);
  await act(async () => (option as HTMLElement).click());
  expect(opened.mock.calls[0][0].detail).toMatchObject({ cwd: "/p/sol", view: "issue", itemId: "13" });
  root.unmount();
});
