import { describe, expect, it } from "vitest";
import { inlinePath } from "./fileLinks";

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
