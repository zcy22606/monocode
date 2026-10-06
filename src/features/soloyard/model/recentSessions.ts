/**
 * Soloyard：侧栏「进行中」面板下面的最近会话——跨项目的会话快捷入口。
 * 会话每开始跑一轮就记进来（标题、目录、harness 的快照，会话卸载了也能显示和打开），
 * 用户手动移除；移除后要等它再跑新的一轮才回来。存 localStorage。
 */
import { useEffect, useSyncExternalStore } from "react";
import { isInFlightSession } from "../../sessions/model/inFlight";
import { isLiveAgentSession } from "../../sessions/model/liveAgents";
import { sessionDisplayTitle, type HarnessId, type Session } from "../../sessions/model/session";

export type RecentSession = { id: string; cwd: string; title: string; harness: HarnessId; at: number };
export type RecentState = { items: RecentSession[]; removed: Record<string, number> };

const KEY = "soloyard.recentSessions";
// ponytail: 只留最新的这么多条，够当快捷入口；要更多再调
const MAX_ITEMS = 50;
const MAX_REMOVED = 200;
const EMPTY: RecentState = { items: [], removed: {} };

function turnStartedAt(session: Session): number | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i].role === "user") return session.blocks[i].startedAt;
  }
  return undefined;
}

/** 在跑的会话记进来 / 刷新时间；已经在列表里的刷新标题和目录。没变化时原样返回。 */
export function recordSessions(state: RecentState, sessions: Session[], now: number): RecentState {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const removed = { ...state.removed };
  let changed = false;
  for (const session of sessions) {
    if (!isLiveAgentSession(session)) continue;
    const prev = byId.get(session.id);
    let at = prev?.at;
    if (isInFlightSession(session)) {
      const started = turnStartedAt(session);
      const removedAt = removed[session.id];
      // 移除之后只有新的一轮才把它带回来
      if (removedAt != null && (started == null || started <= removedAt)) continue;
      if (removedAt != null) delete removed[session.id];
      at = Math.max(prev?.at ?? 0, started ?? (prev ? 0 : now));
    }
    if (at == null) continue;
    const title = sessionDisplayTitle(session.title, session.harness);
    if (prev && prev.at === at && prev.title === title && prev.cwd === session.cwd && prev.harness === session.harness) continue;
    byId.set(session.id, { id: session.id, cwd: session.cwd, title, harness: session.harness, at });
    changed = true;
  }
  if (!changed) return state;
  const items = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
  return { items, removed };
}

export function removeSession(state: RecentState, id: string, now: number): RecentState {
  const removed = Object.fromEntries(
    Object.entries({ ...state.removed, [id]: now })
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_REMOVED),
  );
  return { items: state.items.filter((item) => item.id !== id), removed };
}

let state: RecentState = load();
const listeners = new Set<() => void>();

function load(): RecentState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<RecentState>;
    return { items: Array.isArray(parsed.items) ? parsed.items : [], removed: parsed.removed ?? {} };
  } catch {
    return EMPTY;
  }
}

function commit(next: RecentState) {
  if (next === state) return;
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 存不下就只留在内存里
  }
  listeners.forEach((l) => l());
}

export function removeRecentSession(id: string) {
  commit(removeSession(state, id, Date.now()));
}

/** App 里调一次：会话列表变了就记一下。 */
export function useRecordRecentSessions(sessions: Session[]) {
  useEffect(() => commit(recordSessions(state, sessions, Date.now())), [sessions]);
}

export function useRecentSessions(): RecentSession[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.items,
  );
}
