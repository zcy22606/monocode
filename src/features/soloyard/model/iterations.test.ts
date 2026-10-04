import { describe, expect, it } from "vitest";
import { aiMovedFrom, decodeTarget, encodeTarget, suggestVersions, versionTaken, type Feature, type Iteration } from "./iterations";

const iter = (id: number, tag: string): Iteration => ({ id, tag, name: "", goal: "", target_date: null, status: "planned", sort: id, summary: null });

describe("迭代版本号", () => {
  it("在最大版本上建议小版本和大版本，跳过已占用的", () => {
    expect(suggestVersions([])).toEqual({ minor: "v0.1", major: "v1.0" });
    expect(suggestVersions([iter(1, "v1.1"), iter(2, "v0.1"), iter(3, "v2.0")])).toEqual({ minor: "v2.1", major: "v3.0" });
    expect(suggestVersions([iter(1, "v1.0"), iter(2, "1.1"), iter(3, "v1.2")]).minor).toBe("v1.3");
  });
  it("查重忽略大小写和前缀 v，编辑时排除自己", () => {
    const list = [iter(1, "v1.0")];
    expect(versionTaken(list, "1.0")).toBe(true);
    expect(versionTaken(list, " V1.0 ")).toBe(true);
    expect(versionTaken(list, "v1.0", 1)).toBe(false);
  });
});

describe("去处和 AI 原安排", () => {
  it("select 值和 Target 互转", () => {
    expect(decodeTarget(encodeTarget(12))).toBe(12);
    expect(decodeTarget(encodeTarget("cut"))).toBe("cut");
  });
  it("挪走了才标 AI 原安排", () => {
    const f = { ai_plan: "v1.0", iteration_id: 1, bucket: "pending" } as Feature;
    expect(aiMovedFrom(f, [iter(1, "v1.0")])).toBeNull();
    expect(aiMovedFrom({ ...f, iteration_id: 2 }, [iter(1, "v1.0"), iter(2, "v2.0")])).toBe("v1.0");
    expect(aiMovedFrom({ ...f, ai_plan: "cut" }, [iter(1, "v1.0")])).not.toBeNull();
  });
});
