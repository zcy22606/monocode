/**
 * Soloyard：「服务」分页的历史——跑过的和手动加的服务，按「目录 + 命令」去重，方便以后一键启动。
 * 存 localStorage，按项目分开。
 */
import { useEffect, useState } from "react";

export type HistoryEntry = {
  cwd: string;
  command: string;
  addedAt: number;
  /** 最近一次看到它在跑（秒）。手动加了还没跑过的没有。 */
  lastRunAt?: number;
  /** 最近一次的日志文件，服务停了也能回看。 */
  logPath?: string;
};

type Store = Record<string, HistoryEntry[]>;

const KEY = "soloyard.services.history";
const EVENT = "soloyard:services-history";
/** 列表每 3 秒刷新一次，lastRunAt 隔这么久才写一次，免得一直写存储。 */
const TOUCH_SECS = 60;

export const entryKey = (entry: { cwd: string; command: string }) => `${entry.cwd}\n${entry.command}`;

export function parseEntryKey(key: string): { cwd: string; command: string } | undefined {
  const at = key.indexOf("\n");
  return at > 0 ? { cwd: key.slice(0, at), command: key.slice(at + 1) } : undefined;
}

function readAll(): Store {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeAll(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // private mode / quota
  }
  window.dispatchEvent(new Event(EVENT));
}

export const loadHistory = (project: string): HistoryEntry[] => readAll()[project] ?? [];

/** 合并进历史：已有的更新（只在有变化时写），没有的加上。 */
export function upsertHistory(
  project: string,
  updates: { cwd: string; command: string; lastRunAt?: number; logPath?: string | null }[],
  now = Math.floor(Date.now() / 1000),
) {
  const store = readAll();
  const list = [...(store[project] ?? [])];
  let changed = false;
  for (const update of updates) {
    const index = list.findIndex((entry) => entryKey(entry) === entryKey(update));
    const prev = index >= 0 ? list[index] : undefined;
    const next: HistoryEntry = {
      cwd: update.cwd,
      command: update.command,
      addedAt: prev?.addedAt ?? now,
      lastRunAt: update.lastRunAt ?? prev?.lastRunAt,
      logPath: update.logPath ?? prev?.logPath,
    };
    const stale =
      !prev ||
      next.logPath !== prev.logPath ||
      (next.lastRunAt ?? 0) - (prev.lastRunAt ?? 0) >= TOUCH_SECS ||
      (next.lastRunAt !== undefined && prev.lastRunAt === undefined);
    if (!stale) continue;
    changed = true;
    if (index >= 0) list[index] = next;
    else list.push(next);
  }
  if (changed) writeAll({ ...store, [project]: list });
}

export function removeHistory(project: string, key: string) {
  const store = readAll();
  writeAll({ ...store, [project]: (store[project] ?? []).filter((entry) => entryKey(entry) !== key) });
}

/** 最近跑过 / 刚加的在前。 */
export function sortHistory(list: HistoryEntry[]): HistoryEntry[] {
  return [...list].sort((a, b) => (b.lastRunAt ?? b.addedAt) - (a.lastRunAt ?? a.addedAt));
}

export function useServiceHistory(project: string): HistoryEntry[] {
  const [list, setList] = useState(() => loadHistory(project));
  useEffect(() => {
    const sync = () => setList(loadHistory(project));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [project]);
  return list;
}
