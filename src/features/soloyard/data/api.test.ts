// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { refreshSoloyard, useSoloyard } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

it("sends one request per refresh for identical reads and keeps unchanged results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const call = vi.mocked(invoke).mockImplementation(async () => [{ id: 1 }]);
  const seen: unknown[] = [];
  const Reader = () => {
    seen.push(useSoloyard("sessionLinks", "s1").data);
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render([createElement(Reader, { key: 1 }), createElement(Reader, { key: 2 })]));
  expect(call).toHaveBeenCalledTimes(1);
  const renders = seen.length;
  const first = seen.at(-1);

  await act(async () => refreshSoloyard());
  expect(call).toHaveBeenCalledTimes(2);
  expect(seen.length).toBe(renders); // 结果没变，不重渲染
  expect(seen.at(-1)).toBe(first);

  call.mockImplementation(async () => [{ id: 2 }]);
  await act(async () => refreshSoloyard());
  expect(seen.at(-1)).toEqual([{ id: 2 }]);
  act(() => root.unmount());
});
