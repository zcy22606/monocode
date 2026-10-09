import { beforeEach, describe, expect, it } from "vitest";
import { entryKey, loadHistory, parseEntryKey, removeHistory, renameHistory, sortHistory, upsertHistory } from "./history";

describe("service history", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) },
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  });

  it("dedupes by directory + command and keeps the first addedAt", () => {
    upsertHistory("/p", [{ cwd: "/p", command: "pnpm run dev" }], 100);
    upsertHistory("/p", [{ cwd: "/p", command: "pnpm run dev", lastRunAt: 200, logPath: "/l.log" }], 200);
    upsertHistory("/p", [{ cwd: "/p/web", command: "pnpm run dev" }], 300);
    const list = loadHistory("/p");
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ cwd: "/p", command: "pnpm run dev", addedAt: 100, lastRunAt: 200, logPath: "/l.log" });
    expect(loadHistory("/other")).toEqual([]);
  });

  it("only rewrites lastRunAt once a minute", () => {
    upsertHistory("/p", [{ cwd: "/p", command: "x", lastRunAt: 100 }], 100);
    upsertHistory("/p", [{ cwd: "/p", command: "x", lastRunAt: 130 }], 130);
    expect(loadHistory("/p")[0].lastRunAt).toBe(100);
    upsertHistory("/p", [{ cwd: "/p", command: "x", lastRunAt: 170 }], 170);
    expect(loadHistory("/p")[0].lastRunAt).toBe(170);
  });

  it("removes, sorts and round-trips keys", () => {
    upsertHistory("/p", [{ cwd: "/p", command: "a", lastRunAt: 50 }, { cwd: "/p", command: "b" }], 100);
    expect(sortHistory(loadHistory("/p")).map((e) => e.command)).toEqual(["b", "a"]);
    removeHistory("/p", entryKey({ cwd: "/p", command: "b" }));
    expect(loadHistory("/p").map((e) => e.command)).toEqual(["a"]);
    expect(parseEntryKey(entryKey({ cwd: "/p", command: "PORT=1 npm run dev" }))).toEqual({ cwd: "/p", command: "PORT=1 npm run dev" });
  });
  it("keeps a service's name across updates and clears it with an empty name", () => {
    renameHistory("/p", { cwd: "/p", command: "pnpm dev" }, "  web  ");
    expect(loadHistory("/p")[0].name).toBe("web");
    upsertHistory("/p", [{ cwd: "/p", command: "pnpm dev", lastRunAt: 9999, logPath: "/l.log" }]);
    expect(loadHistory("/p")[0]).toMatchObject({ name: "web", logPath: "/l.log" });
    renameHistory("/p", { cwd: "/p", command: "pnpm dev" }, "");
    expect(loadHistory("/p")[0].name).toBeUndefined();
  });
});
