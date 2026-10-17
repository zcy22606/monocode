import { useCallback, useEffect, useRef, useState } from "react";
import { HostError } from "./rpc";

/** 每个 key 最近一次的结果。回到某一屏时先显示它，不闪加载。 */
const cache = new Map<string, unknown>();
// 项目、会话列表、模型列表还存进 localStorage：下次打开 app 立刻有东西看（对话本身不存，太大）
const PERSIST = /^(projects$|sessions:|models:|mirror:)/;
const STORE = "soloyard.mobile.cache.";
function stored(key: string) {
  try {
    const raw = localStorage.getItem(STORE + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
export const cached = <T,>(key: string) => (cache.has(key) ? cache.get(key) : PERSIST.test(key) ? stored(key) : undefined) as T | undefined;
function remember(key: string, data: unknown) {
  cache.set(key, data);
  if (!PERSIST.test(key)) return;
  try {
    localStorage.setItem(STORE + key, JSON.stringify(data));
  } catch {
    // 存不下就只放内存
  }
}
/** 断开主机时清掉，换了主机不会看到上一台的东西。 */
export function clearCache() {
  cache.clear();
  for (const key of Object.keys(localStorage)) if (key.startsWith(STORE)) localStorage.removeItem(key);
}

const visible = () => document.visibilityState === "visible";

/**
 * 轮询：成功按 `interval(数据)` 排下一次，失败按 1s、2s、4s、8s 退避；
 * app 切到后台就停，回到前台立刻拉一次。`active` 为 false（这一屏被盖住）时也停。
 */
export function usePoll<T>(
  key: string | null,
  load: () => Promise<T>,
  interval: (data: T | undefined) => number,
  active = true,
) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: HostError }>(() => ({
    key,
    data: key ? cached<T>(key) : undefined,
  }));
  const loadRef = useRef(load);
  loadRef.current = load;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const kick = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!key || !active) return;
    let disposed = false;
    let timer: number | undefined;
    let failed = 0;
    let inflight: Promise<void> | null = null;
    const tick = () =>
      (inflight ??= (async () => {
        window.clearTimeout(timer);
        try {
          const data = await loadRef.current();
          if (disposed) return;
          failed = 0;
          remember(key, data);
          setState({ key, data });
        } catch (reason) {
          if (disposed) return;
          failed++;
          setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: reason as HostError }));
        } finally {
          inflight = null;
        }
        if (!disposed && visible())
          timer = window.setTimeout(
            tick,
            failed ? Math.min(8000, 1000 * 2 ** (failed - 1)) : intervalRef.current(cached<T>(key)),
          );
      })());
    kick.current = tick;
    const onVisibility = () => (visible() ? void tick() : window.clearTimeout(timer));
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, active]);

  const refresh = useCallback(() => kick.current(), []);
  const mine = state.key === key;
  return {
    data: mine ? state.data ?? (key ? cached<T>(key) : undefined) : key ? cached<T>(key) : undefined,
    error: mine ? state.error : undefined,
    refresh,
  };
}
