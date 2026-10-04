import { describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("../data/api", () => ({ soloyardCall: call }));

import {
  soloyardClaudeAddDirArgs,
  soloyardTurnContext,
  withSoloyardWritableRoots,
} from "./sessionContext";

describe("soloyardTurnContext", () => {
  it("appends only what the message @-references, and refreshes extra dirs every turn", async () => {
    call.mockResolvedValue({ dirs: ["/x/lib"], text: "Issue SOL-5: links" });
    const text = await soloyardTurnContext("s", "look at @link/SOL-5");
    expect(call).toHaveBeenCalledWith("sessionContext", "s", "look at @link/SOL-5");
    expect(text).toContain("<soloyard_context>");
    expect(text).toContain("Issue SOL-5: links");
    expect(soloyardClaudeAddDirArgs("s")).toEqual(["--add-dir", "/x/lib"]);

    call.mockResolvedValue({ dirs: [], text: "" });
    expect(await soloyardTurnContext("s", "no references")).toBe("");
    expect(soloyardClaudeAddDirArgs("s")).toEqual([]);
  });

  it("never blocks sending when the data process is down", async () => {
    call.mockImplementation(async () => {
      throw new Error("sidecar down");
    });
    expect(await soloyardTurnContext("s", "@link/SOL-5")).toBe("");
  });

  it("adds writable roots only to Codex's workspace-write sandbox", async () => {
    call.mockResolvedValue({ dirs: ["/a", "/b"], text: "" });
    await soloyardTurnContext("c", "");
    expect(withSoloyardWritableRoots({ sandboxPolicy: { type: "workspaceWrite", networkAccess: true } }, "c")).toEqual({
      sandboxPolicy: { type: "workspaceWrite", networkAccess: true, writableRoots: ["/a", "/b"] },
    });
    const readOnly = { sandboxPolicy: { type: "readOnly" } };
    expect(withSoloyardWritableRoots(readOnly, "c")).toBe(readOnly);
    const other = { sandboxPolicy: { type: "workspaceWrite" } };
    expect(withSoloyardWritableRoots(other, "no-links")).toBe(other);
  });
});
