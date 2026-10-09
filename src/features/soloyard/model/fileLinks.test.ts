import { describe, expect, it } from "vitest";
import { inlineFolderPath } from "./fileLinks";

describe("inlineFolderPath", () => {
  it("accepts trailing-slash, absolute and home paths", () => {
    expect(inlineFolderPath("output/")).toBe("output/");
    expect(inlineFolderPath("~/Playground/proof/x-2026-10-08/")).toBe("~/Playground/proof/x-2026-10-08/");
    expect(inlineFolderPath("/Users/me/project")).toBe("/Users/me/project");
  });

  it("leaves branch names, commands and URLs alone", () => {
    expect(inlineFolderPath("mc/abc")).toBeUndefined();
    expect(inlineFolderPath("git status")).toBeUndefined();
    expect(inlineFolderPath("https://x.dev/a/")).toBeUndefined();
    expect(inlineFolderPath("/")).toBeUndefined();
  });
});
