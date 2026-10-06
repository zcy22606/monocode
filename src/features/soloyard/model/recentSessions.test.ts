import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { recordSessions, removeSession, type RecentState } from "./recentSessions";

const session = (id: string, opts: { busy?: boolean; startedAt?: number; title?: string; cwd?: string } = {}) =>
  ({
    id,
    cwd: opts.cwd ?? "/p/a",
    title: opts.title ?? id,
    harness: "claude",
    busy: opts.busy ?? false,
    blocks: [{ id: "u", role: "user", text: "hi", startedAt: opts.startedAt }],
  }) as unknown as Session;

const empty: RecentState = { items: [], removed: {} };

describe("recent sessions", () => {
  it("records sessions when a turn runs, newest first, and ignores idle ones", () => {
    let s = recordSessions(empty, [session("a", { busy: true, startedAt: 10 }), session("b")], 99);
    expect(s.items.map((i) => i.id)).toEqual(["a"]);
    s = recordSessions(s, [session("a"), session("b", { busy: true, startedAt: 20 })], 99);
    expect(s.items.map((i) => [i.id, i.at])).toEqual([["b", 20], ["a", 10]]);
    expect(recordSessions(s, [session("a"), session("b", { busy: true, startedAt: 20 })], 99)).toBe(s);
  });

  it("refreshes the title of a recorded session even when idle", () => {
    const s = recordSessions(empty, [session("a", { busy: true, startedAt: 10 })], 99);
    expect(recordSessions(s, [session("a", { title: "Renamed" })], 99).items[0].title).toBe("Renamed");
  });

  it("keeps a removed session out until it runs a new turn", () => {
    let s = recordSessions(empty, [session("a", { busy: true, startedAt: 10 })], 99);
    s = removeSession(s, "a", 50);
    expect(s.items).toEqual([]);
    expect(recordSessions(s, [session("a", { busy: true, startedAt: 10 })], 99).items).toEqual([]);
    s = recordSessions(s, [session("a", { busy: true, startedAt: 60 })], 99);
    expect(s.items.map((i) => i.id)).toEqual(["a"]);
    expect(s.removed).toEqual({});
  });

  it("skips inbox discussions", () => {
    const ask = { ...session("x", { busy: true, startedAt: 1 }), inboxAsk: {} } as unknown as Session;
    expect(recordSessions(empty, [ask], 99).items).toEqual([]);
  });
});
