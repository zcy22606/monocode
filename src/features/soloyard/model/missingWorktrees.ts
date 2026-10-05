// Soloyard: an open session whose worktree was deleted behind the app's back (e.g. the agent ran
// `git worktree remove` in its own turn) still points at the gone folder, and the next send fails
// with "No such file or directory". The backend only detaches such sessions when it reads them,
// so open ones are rechecked whenever they go idle and when the window comes back.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../../sessions/model/session";

const watched = (session: Session) =>
  !session.busy && !session.worktreeRemoved && !!session.worktreeCwd;

export function useMissingWorktrees(
  sessions: readonly Session[],
  onMissing: (ids: Set<string>) => void,
) {
  const latest = useRef({ sessions, onMissing });
  latest.current = { sessions, onMissing };
  const key = sessions
    .filter(watched)
    .map((session) => `${session.id}:${session.worktreeCwd}`)
    .join("\n");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const check = async () => {
      const candidates = latest.current.sessions.filter(watched);
      const gone = new Set(
        await invoke<string[]>("soloyard_missing_worktrees", {
          paths: [...new Set(candidates.map((session) => session.worktreeCwd!))],
        }).catch(() => []),
      );
      const ids = candidates
        .filter((session) => gone.has(session.worktreeCwd!))
        .map((session) => session.id);
      if (!cancelled && ids.length) latest.current.onMissing(new Set(ids));
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
}
