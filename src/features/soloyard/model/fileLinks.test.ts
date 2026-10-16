import { describe, expect, it, vi } from "vitest";
import { inlinePath, memoryFile } from "./fileLinks";
import { resolveOpenablePath } from "../../files/model/fileIndex";

const cwd = "/Users/me/Workspace/openroboto";
const memory = "/Users/me/.claude/projects/-Users-me-Workspace-openroboto/memory";
const elsewhere = "/Users/me/Playground/proof/x/App.tsx";
const onDisk = new Set([
  `${cwd}/web/src/App.tsx`,
  `${memory}/state-1014.md`,
  `${memory}/App.tsx`,
  elsewhere,
  `${cwd}/dist/App.tsx`,
]);

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  listProjectFiles: vi.fn(async () => [{ name: "App.tsx", path: `${cwd}/web/src/App.tsx`, relative: "web/src/App.tsx" }]),
  statFiles: vi.fn(async (paths: string[]) => paths.map((path) => ({ path, mtimeMs: onDisk.has(path) ? 1 : null }))),
}));

describe("inlinePath", () => {
  it("reads folders from a trailing slash or an absolute / home path", () => {
    expect(inlinePath("output/")).toEqual({ name: "output", isDir: true });
    expect(inlinePath(".gstack/")).toEqual({ name: ".gstack", isDir: true });
    expect(inlinePath("~/Playground/proof/x-2026-10-08/")).toEqual({ name: "x-2026-10-08", isDir: true });
    expect(inlinePath("/Users/me/project")).toEqual({ name: "project", isDir: true });
  });

  it("reads files with non-ASCII names", () => {
    expect(inlinePath("/Users/me/w/OpenRoboto矿工从零上手指南.md")).toEqual({
      name: "OpenRoboto矿工从零上手指南.md",
      isDir: false,
    });
    expect(inlinePath("指南.md:12")).toEqual({ name: "指南.md", isDir: false });
  });

  it("leaves branch names, commands and URLs alone", () => {
    expect(inlinePath("mc/abc")).toBeUndefined();
    expect(inlinePath("git status")).toBeUndefined();
    expect(inlinePath("https://x.dev/a/")).toBeUndefined();
    expect(inlinePath("/")).toBeUndefined();
  });
});


describe("memoryFile", () => {
  it("puts a bare name in Claude Code's memory folder for the cwd", () => {
    expect(memoryFile("state-1014.md", cwd)).toBe(`${memory}/state-1014.md`);
    expect(memoryFile("state-1014.md", `${cwd}/`)).toBe(`${memory}/state-1014.md`);
  });

  it("leaves paths with folders alone", () => {
    expect(memoryFile("docs/a.md", cwd)).toBeUndefined();
    expect(memoryFile("", cwd)).toBeUndefined();
  });
});

describe("resolveOpenablePath with Claude memory files", () => {
  // AgentMarkdown hands over the name already joined onto the cwd.
  it("opens a memory file the project has no match for", async () => {
    await expect(resolveOpenablePath(cwd, `${cwd}/state-1014.md`)).resolves.toBe(`${memory}/state-1014.md`);
  });

  it("still prefers the project's own file", async () => {
    await expect(resolveOpenablePath(cwd, `${cwd}/App.tsx`)).resolves.toBe(`${cwd}/web/src/App.tsx`);
  });

  it("keeps the path when neither has it", async () => {
    await expect(resolveOpenablePath(cwd, `${cwd}/nope.md`)).resolves.toBe(`${cwd}/nope.md`);
    await expect(resolveOpenablePath(cwd, "/tmp/nope.md")).resolves.toBe("/tmp/nope.md");
  });
});

describe("resolveOpenablePath with real files the index skips", () => {
  it("opens a file outside the project as named, not the project's same-named file", async () => {
    await expect(resolveOpenablePath(cwd, elsewhere)).resolves.toBe(elsewhere);
    await expect(resolveOpenablePath(cwd, "~/Playground/proof/x/App.tsx")).resolves.toBe(elsewhere);
  });

  it("opens a gitignored file inside the project as named", async () => {
    await expect(resolveOpenablePath(cwd, `${cwd}/dist/App.tsx`)).resolves.toBe(`${cwd}/dist/App.tsx`);
  });
});
