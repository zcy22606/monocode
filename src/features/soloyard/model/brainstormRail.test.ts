/**
 * 想法 → 项目栏的同步（syncIdeas）：进「头脑风暴」分组、标题当项目名、搁置 / 放弃 = 归档、恢复回来；
 * 用户自己归档的不被捞回来。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import { archiveProject, loadArchivedProjects, loadRecents, rememberProject } from "../../projects/model/recents";
import { loadProjectGroupAssignments, loadProjectGroups } from "../../projects/model/projectGroups";
import { loadTabGroupLabels } from "../../workspace/model/tabGroups";
import { IDEAS_GROUP_ID, syncIdeas, type Idea } from "./brainstorm";

const root = "/Users/me/Library/Application Support/x/workspace";
const idea = (id: number, folder: string, extra: Partial<Idea> = {}): Idea => ({
  id, path: `${root}/${folder}`, name: "", slug: null, goal: "", stage: "idea", note: null, updated_at: "2026-10-13T00:00:00Z", ...extra,
});
const inRail = (path: string) => loadRecents().some((r) => r.path === path);
const archived = (path: string) => loadArchivedProjects().some((r) => r.path === path);

describe("想法同步到项目栏", () => {
  // 模型测试跑在 node 里：和 recents.test.ts 一样给一个内存版 localStorage
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  it("第一次看到的想法进项目栏和「头脑风暴」分组，标题当项目名；标题变了跟着改", () => {
    const a = idea(1, "2026-10-13-0900", { name: "小红书复盘助手" });
    syncIdeas([a]);
    expect(inRail(a.path)).toBe(true);
    expect(loadProjectGroups().some((g) => g.id === IDEAS_GROUP_ID)).toBe(true);
    expect(loadProjectGroupAssignments()[projectKey(a.path)]).toBe(IDEAS_GROUP_ID);
    expect(loadTabGroupLabels()[projectKey(a.path)]).toBe("小红书复盘助手");

    syncIdeas([{ ...a, name: "小红书新手复盘助手" }]);
    expect(loadTabGroupLabels()[projectKey(a.path)]).toBe("小红书新手复盘助手");
  });

  it("搁置 / 放弃 = 归档项目，恢复 = 回到项目栏；用户自己归档过的想法不被捞回来", () => {
    const b = idea(2, "2026-10-13-1000", { name: "营销日历" });
    syncIdeas([b]);
    syncIdeas([{ ...b, stage: "parked" }]);
    expect(inRail(b.path)).toBe(false);
    expect(archived(b.path)).toBe(true);

    syncIdeas([{ ...b, stage: "idea" }]);
    expect(inRail(b.path)).toBe(true);
    expect(archived(b.path)).toBe(false);

    // 用户在项目栏里归档了一个想法：下次启动第一次看到它时不动
    const c = idea(3, "2026-10-13-1100", { name: "第三个" });
    rememberProject(c.path);
    archiveProject(c.path);
    syncIdeas([c]);
    expect(inRail(c.path)).toBe(false);
    expect(archived(c.path)).toBe(true);
  });
});
