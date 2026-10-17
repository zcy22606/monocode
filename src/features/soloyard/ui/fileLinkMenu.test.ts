// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";

const actions = vi.hoisted(() => ({
  copyText: vi.fn(async () => {}),
  revealPath: vi.fn(async () => {}),
  openPathWithDefaultApp: vi.fn(async () => {}),
}));
const wallet = "/Users/me/.bittensor/wallets/company-miner/MNEMONICS.txt";
const token = "/Users/me/.cache/huggingface/token";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: actions.copyText }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  revealPath: actions.revealPath,
  openPathWithDefaultApp: actions.openPathWithDefaultApp,
  listDir: vi.fn(async (dir: string) => [
    { name: "token", path: `${dir}/token`, isDir: false, ignored: false },
    { name: "output", path: `${dir}/output`, isDir: true, ignored: false },
  ]),
}));
vi.mock("../../files/model/fileIndex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../files/model/fileIndex")>()),
  resolveOpenablePath: vi.fn(async (_cwd: string, path: string) =>
    path === "/repo/MNEMONICS.txt" ? wallet : path,
  ),
}));

let container: HTMLDivElement;
let root: Root;
let onOpenFile: ReturnType<typeof vi.fn>;

function render(text: string) {
  act(() => root.render(createElement(AgentMarkdown, { text, cwd: "/repo", onOpenFile })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  onOpenFile = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function pick(label: string) {
  await act(async () => {
    container.querySelector("code")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent === label,
  )!;
  await act(async () => item.click());
}

async function click() {
  await act(async () => container.querySelector("code")!.click());
}

describe("file link context menu (Soloyard)", () => {
  it("reveals and copies the file a click would open, not the path joined onto the cwd", async () => {
    render("助记词在 `MNEMONICS.txt`。");
    const reveal = /Mac/.test(navigator.platform)
      ? "Reveal in Finder"
      : /Win/i.test(navigator.platform)
        ? "Reveal in File Explorer"
        : "Open Containing Folder";
    await pick(reveal);
    expect(actions.revealPath).toHaveBeenCalledWith(wallet);
    await pick("Copy Path");
    expect(actions.copyText).toHaveBeenLastCalledWith(wallet);
  });

  it("opens an extensionless file in the app, though its link looks like a folder", async () => {
    render(`token 在 \`${token}\``);
    await click();
    expect(onOpenFile).toHaveBeenCalledWith(token);
    onOpenFile.mockClear();
    await pick("Open in MonoCode");
    expect(onOpenFile).toHaveBeenCalledWith(token);
    expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
  });

  it("still opens a real folder in Finder", async () => {
    render("输出在 `/Users/me/work/output`");
    await click();
    expect(actions.openPathWithDefaultApp).toHaveBeenCalledWith("/Users/me/work/output");
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
