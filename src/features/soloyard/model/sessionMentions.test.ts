import { describe, expect, it } from "vitest";
import { isSoloyardMentionPath, linksAsMentionFiles, rankSoloyardMentions } from "./sessionMentions";

const links = [
  { kind: "issue", target: "5", code: "SOL-5", title: "会话关联", mention: "link/SOL-5" },
  { kind: "document", target: "2", code: null, title: "立项卡", mention: "link/doc-2" },
  { kind: "feature", target: "9", code: "X-1", title: "已删除", mention: "link/X-1", missing: true },
];

describe("soloyard @ mentions", () => {
  it("offers linked items (not deleted ones) with @link labels", () => {
    const files = linksAsMentionFiles(links);
    expect(files.map((f) => [f.name, f.relative])).toEqual([["SOL-5 会话关联", "link/SOL-5"], ["立项卡", "link/doc-2"]]);
    expect(files.every((f) => isSoloyardMentionPath(f.path))).toBe(true);
    expect(isSoloyardMentionPath("note:abc")).toBe(false);
  });

  it("lists everything without a query and filters by title or label", () => {
    const files = linksAsMentionFiles(links);
    expect(rankSoloyardMentions(files, "")).toHaveLength(2);
    expect(rankSoloyardMentions(files, "立项").map((f) => f.relative)).toEqual(["link/doc-2"]);
    expect(rankSoloyardMentions(files, "sol").map((f) => f.relative)).toEqual(["link/SOL-5"]);
    expect(rankSoloyardMentions(files, "zzz")).toEqual([]);
  });
});
