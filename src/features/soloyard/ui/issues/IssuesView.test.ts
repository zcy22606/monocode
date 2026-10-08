// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Issue } from "../../model/issues";
import { DEFAULT_VIEW, saveIssueView } from "../../model/issueView";

const api = vi.hoisted(() => ({ issues: [] as unknown[], mutate: vi.fn() }));
vi.mock("../../data/api", () => ({
  useSoloyard: () => ({ data: api.issues }),
  mutateSoloyard: api.mutate,
}));
const open = vi.hoisted(() => vi.fn());
vi.mock("../../model/projectViews", () => ({ openProjectView: open }));

const { IssuesView } = await import("./IssuesView");

const issue = (number: number, patch: Partial<Issue> = {}): Issue => ({
  id: number, project_id: 1, number, ident: `APP-${number}`, title: `Issue ${number}`, body_md: "", status: "todo",
  priority: 0, labels: [], created_at: "2026-10-01", updated_at: "2026-10-01", completed_at: null,
  version: 1, children: 0, children_done: 0, sessions: 0, ...patch,
});

let container: HTMLDivElement;
let root: Root;
const project = { id: 1, key: "APP", name: "App" } as never;
const render = () => act(() => root.render(createElement(IssuesView, { project, cwd: "/app" })));
const flush = () => act(async () => {});
const byText = (text: string, selector = "button") =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === text)!;
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = (el: Element, init: MouseEventInit = {}) =>
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const row = (title: string) => byText(title, "span").closest<HTMLElement>('[role="button"]')!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  api.issues = [issue(1, { status: "in_review" }), issue(2, { status: "in_review", priority: 3 }), issue(3)];
  api.mutate.mockReset();
  open.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("⌘ / Shift click selects rows, accepts only In Review ones as one batch, and undoes the batch", async () => {
  api.mutate.mockResolvedValue("update-issues:b1");
  render();
  click(row("Issue 3"), { metaKey: true });
  click(row("Issue 1"), { shiftKey: true });
  expect(open).not.toHaveBeenCalled();
  expect(byText("3 selected", "span")).toBeTruthy();

  click(row("Issue 3"), { metaKey: true }); // ⌘ 再点一次取消
  expect(byText("2 selected", "span")).toBeTruthy();
  click(byText("Accept (2)"));
  await flush();
  expect(api.mutate).toHaveBeenCalledWith("updateIssues", [1, 2], { status: "done" });

  click(byText("Undo"));
  await flush();
  expect(api.mutate).toHaveBeenLastCalledWith("revertBatch", "update-issues:b1");
});

it("bulk-changes priority from the selection bar; plain click clears the selection and opens", async () => {
  api.mutate.mockResolvedValue("update-issues:b2");
  render();
  click(byLabel("Select APP-1"));
  click(byLabel("Select APP-3"));
  click(byText("Priority"));
  click(byText("Urgent"));
  await flush();
  expect(api.mutate).toHaveBeenCalledWith("updateIssues", [1, 3], { priority: 1 });

  click(row("Issue 2"));
  expect(open).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain("selected");
});

it("changes one issue's priority from the row and the board card without opening it", () => {
  render();
  click(row("Issue 2").querySelector('[aria-label="Priority: Medium"]')!);
  click(byText("High"));
  expect(api.mutate).toHaveBeenCalledWith("updateIssue", 2, { priority: 2 });

  act(() => root.unmount());
  saveIssueView(1, { ...DEFAULT_VIEW, layout: "board" });
  root = createRoot(container);
  render();
  click(row("Issue 3").querySelector('[aria-label="Priority: No priority"]')!);
  click(byText("Low"));
  expect(api.mutate).toHaveBeenLastCalledWith("updateIssue", 3, { priority: 4 });
  click(row("Issue 3"), { metaKey: true });
  expect(byText("1 selected", "span")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});

it("picks a priority while creating an issue inline", async () => {
  render();
  click(byText("New issue"));
  click(byLabel("Priority: No priority"));
  click(byText("Urgent"));
  const input = document.querySelector<HTMLInputElement>('input[placeholder^="Issue title"]')!;
  expect(input).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fix login");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(api.mutate).toHaveBeenCalledWith("createIssue", 1, { title: "Fix login", status: "todo", priority: 1 });
});

it("creates the first issue from an empty board, and ignores the Enter that picks an IME candidate", async () => {
  api.issues = [];
  saveIssueView(1, { ...DEFAULT_VIEW, layout: "board" });
  render();
  click(byText("New issue"));
  const input = document.querySelector<HTMLInputElement>('input[placeholder^="Issue title"]')!;
  expect(input).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "denglu");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // WebKit：确认选字的回车 keyCode 是 229
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
  });
  expect(api.mutate).not.toHaveBeenCalled();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(api.mutate).toHaveBeenCalledWith("createIssue", 1, { title: "denglu", priority: 0 });
});

it("shows column names in the list header; its checkbox selects and clears all visible issues", () => {
  render();
  const header = byLabel("Select all").parentElement!;
  expect([...header.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["Priority", "ID", "Status", "Title", "Labels", "Created"]);
  click(byLabel("Select all"));
  expect(byText("3 selected", "span")).toBeTruthy();
  click(byLabel("Select all"));
  expect(document.body.textContent).not.toContain("selected");
});
