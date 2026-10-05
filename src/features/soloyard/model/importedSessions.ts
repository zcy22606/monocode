// Soloyard: the history import appends turns continued in the terminal (src-tauri/src/history_import.rs).
// A session already loaded in memory would keep showing — and later save back — its stale copy.
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export function useImportedSessions(onImported: (ids: string[]) => void) {
  const latest = useRef(onImported);
  latest.current = onImported;
  useEffect(() => {
    const unlisten = listen<string[]>("soloyard:sessions-imported", ({ payload }) =>
      latest.current(payload),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);
}
