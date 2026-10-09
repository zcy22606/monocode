import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
vi.mock("../data/api", () => ({ soloyardCall: call, mutateSoloyard: mutate }));

import { acceptIssue } from "./acceptIssue";

const where = { repo: "/ws/openroboto-backend", branch: "mc/ope-2", target: "main" };

describe("acceptIssue", () => {
  beforeEach(() => {
    call.mockReset();
    mutate.mockReset();
  });

  it("merges the worktree branch, records it, then marks the issue done", async () => {
    call.mockResolvedValue({ merged: true, commit: "abc123", ...where });
    expect(await acceptIssue(2)).toBeNull();
    expect(call).toHaveBeenCalledWith("mergeIssueBranch", 2);
    expect(mutate.mock.calls).toEqual([
      ["addComment", 2, "Accepted: merged mc/ope-2 into openroboto-backend/main (abc123)."],
      ["updateIssue", 2, { status: "done" }],
    ]);
  });

  it("just marks done when there is nothing to merge", async () => {
    call.mockResolvedValue({ merged: false, reason: "nothing" });
    expect(await acceptIssue(3)).toBeNull();
    expect(mutate.mock.calls).toEqual([["updateIssue", 3, { status: "done" }]]);
  });

  it("leaves the issue in review and explains when the merge can't happen", async () => {
    call.mockResolvedValue({ merged: false, reason: "conflict", files: ["b.txt"], ...where });
    expect(await acceptIssue(4)).toContain("conflicts with openroboto-backend/main (b.txt)");
    expect(mutate).not.toHaveBeenCalled();
  });
});
