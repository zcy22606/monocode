import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { newSession, type Session } from "../../sessions/model/session";
import { placeSession } from "./missingWorktrees";

const removed: Session = {
  ...newSession("claude", "/p/root"),
  worktreeCwd: "/p/root/backend-worktrees/mc-1",
  worktreeRemoved: true,
  providerSessionId: "claude-1",
  blocks: [
    { id: "u1", role: "user", text: "merge it and clean the worktree" },
    { id: "a1", role: "assistant", text: "Merged; worktree removed." },
  ],
} as Session;

describe("placeSession", () => {
  it("resumes a session whose worktree was deleted in the folder picked, telling the agent it moved", () => {
    const next = placeSession(removed, { workCwd: "/p/root/backend", branch: "main" });
    expect(next).toMatchObject({ worktreeCwd: "/p/root/backend", branch: "main", worktreeRemoved: undefined, providerSessionId: "claude-1" });
    const handoff = next.blocks.at(-1)!;
    expect(handoff.handoff).toMatchObject({ status: "ready", pending: true });
    expect(handoff.text).toContain("The previous working copy was deleted");
    expect(handoff.text).not.toContain("merge it and clean the worktree");
    expect(placeSession(removed, {})).toMatchObject({ worktreeCwd: undefined, providerSessionId: "claude-1" });
  });

  it("starts over with a recap without a conversation to resume, or in a worktree that doesn't exist yet", () => {
    for (const next of [
      placeSession({ ...removed, providerSessionId: undefined }, { workCwd: "/p/root/backend" }),
      placeSession(removed, { workCwd: "/p/root/backend", newWorktree: true }),
    ]) {
      expect(next.providerSessionId).toBeUndefined();
      expect(next.blocks.at(-1)!.text).toContain("merge it and clean the worktree");
    }
    expect(placeSession(removed, { workCwd: "/p/root/backend", newWorktree: true })).toMatchObject({ workspaceMode: "worktree", worktreeBase: "HEAD" });
  });

  it("only places a blank session, without a note", () => {
    const blank = newSession("claude", "/p/root");
    expect(placeSession(blank, { workCwd: "/p/root/backend" })).toMatchObject({ worktreeCwd: "/p/root/backend", blocks: [] });
  });
});
