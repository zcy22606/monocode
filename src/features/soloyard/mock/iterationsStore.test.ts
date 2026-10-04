import { describe, expect, it } from "vitest";
import type { MockIteration } from "./iterationsMock";
import { iterationsSnapshot, locked, mockActions, resetIterationsMock, suggestVersions, unfinished, versionTaken } from "./iterationsStore";

const it_ = (id: string, version: string): MockIteration => ({ id, version, name: "", goal: "", status: "planned", kind: "release" });

describe("迭代版本号", () => {
  it("在最大版本上建议小版本和大版本，跳过已占用的", () => {
    expect(suggestVersions([])).toEqual({ minor: "v0.1", major: "v1.0" });
    expect(suggestVersions([it_("a", "v1.1"), it_("b", "v0.1"), it_("c", "v2.0")])).toEqual({ minor: "v2.1", major: "v3.0" });
    expect(suggestVersions([it_("a", "v1.0"), it_("b", "1.1"), it_("c", "v2.0")]).minor).toBe("v2.1");
    expect(suggestVersions([it_("a", "v1.0"), it_("b", "v1.1")].concat(it_("c", "v1.2"))).minor).toBe("v1.3");
  });
  it("查重忽略大小写和前缀 v，编辑时排除自己", () => {
    const list = [it_("a", "v1.0"), { ...it_("cut", ""), kind: "cut" as const }];
    expect(versionTaken(list, "1.0")).toBe(true);
    expect(versionTaken(list, " V1.0 ")).toBe(true);
    expect(versionTaken(list, "v1.0", "a")).toBe(false);
    expect(versionTaken(list, "")).toBe(false);
  });
});

describe("开始 / 完成 / 重新打开", () => {
  it("只给勾选的功能建 issue；完成时挪走没做完的、冻结统计、锁定；重新打开解锁", () => {
    resetIterationsMock();
    let s = iterationsSnapshot();
    const v10 = Object.entries(s.placement).filter(([, w]) => w === "v1.0").map(([c]) => c);
    mockActions.start("v1.0", v10.slice(0, 2));
    s = iterationsSnapshot();
    expect(v10.filter((c) => s.issues[c]).length).toBe(2);
    expect(s.iterations.find((i) => i.id === "v1.0")?.status).toBe("active");

    const left = v10.filter((c) => unfinished(s, c));
    mockActions.finish("v1.0", Object.fromEntries(left.map((c) => [c, "v1.1"])));
    s = iterationsSnapshot();
    expect(s.iterations.find((i) => i.id === "v1.0")?.summary).toEqual({ done: v10.length - left.length, moved: left.length });
    expect(locked(s, "v1.0")).toBe(true);
    mockActions.move(left[0], "v1.0");
    expect(iterationsSnapshot().placement[left[0]]).toBe("v1.1");

    mockActions.reopen("v1.0");
    expect(locked(iterationsSnapshot(), "v1.0")).toBe(false);
  });
});
