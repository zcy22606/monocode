/** Soloyard：顶栏标签区收起成「当前标题 ▾ N」（SOL-66），默认展开，记在 localStorage。 */
import { useSyncExternalStore } from "react";

const KEY = "soloyard.titleTabsCollapsed";
const listeners = new Set<() => void>();
let collapsed = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";

export function useTitleTabsCollapsed(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => collapsed,
  );
}

export function toggleTitleTabsCollapsed() {
  collapsed = !collapsed;
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // private mode / quota
  }
  listeners.forEach((l) => l());
}
