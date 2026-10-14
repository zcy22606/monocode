import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { newSession, type Session } from "../../sessions/model/session";
import { placeSession } from "./missingWorktrees";

const removed: Session = {
  ...newSession("claude", "/p/root"),
  worktreeCwd: "/p/root/backend-worktrees/mc-1",
  worktreeRemoved: true,
  blocks: [
    { id: "u1", role: "user", text: "merge it and clean the worktree" },
    { id: "a1", role: "assistant", text: "Merged; worktree removed." },
  ],
} as Session;

describe("placeSession", () => {
  it("re-places a session whose worktree was deleted, carrying a recap to the fresh conversation", () => {
    const next = placeSession(removed, { workCwd: "/p/root/backend", branch: "main" });
    expect(next).toMatchObject({ worktreeCwd: "/p/root/backend", branch: "main", worktreeRemoved: undefined, workspaceMode: undefined });
    const handoff = next.blocks.at(-1)!;
    expect(handoff.handoff).toMatchObject({ status: "ready", pending: true });
    expect(handoff.text).toContain("The previous working copy was deleted");
    expect(handoff.text).toContain("merge it and clean the worktree");
  });

  it("can continue at the project root or in a new worktree of a member repo", () => {
    expect(placeSession(removed, {}).worktreeCwd).toBeUndefined();
    expect(placeSession(removed, { workCwd: "/p/root/backend", newWorktree: true })).toMatchObject({ workspaceMode: "worktree", worktreeBase: "HEAD" });
  });

  it("only places a blank session, without a recap", () => {
    const blank = newSession("claude", "/p/root");
    expect(placeSession(blank, { workCwd: "/p/root/backend" })).toMatchObject({ worktreeCwd: "/p/root/backend", blocks: [] });
  });
});
