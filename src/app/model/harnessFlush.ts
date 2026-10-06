export type ScheduledFlush = { kind: "raf" | "timeout"; id: number };

export function cancelScheduledFlush(handle: ScheduledFlush | null) {
  if (!handle) return;
  if (handle.kind === "raf") cancelAnimationFrame(handle.id);
  else clearTimeout(handle.id);
}

// Soloyard: each flush re-renders the whole App; at 100ms a few background streams kept the
// WebView main thread ~40% busy and clicks lagged. Hidden output only drives sidebar status.
export const BACKGROUND_FLUSH_MS = 500;

/** Hidden output must keep advancing without driving the whole UI at 60–120Hz. */
export function scheduleHarnessFlush(
  run: () => void,
  foreground: boolean,
): ScheduledFlush {
  if (document.hidden || !foreground) {
    return { kind: "timeout", id: window.setTimeout(run, BACKGROUND_FLUSH_MS) };
  }
  return { kind: "raf", id: requestAnimationFrame(run) };
}
