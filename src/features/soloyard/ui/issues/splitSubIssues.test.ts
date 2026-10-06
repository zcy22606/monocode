import { describe, expect, it } from "vitest";
import type { Issue } from "../../model/issues";
import { splitSubIssues } from "./IssuesView";

const issue = (id: number, parent_id: number | null = null) => ({ id, parent_id }) as Issue;

describe("splitSubIssues", () => {
  it("keeps top-level issues in order and groups sub-issues under their parent", () => {
    const { issues, subIssues } = splitSubIssues([issue(1), issue(2, 1), issue(3), issue(4, 1), issue(5, 99)]);
    expect(issues.map((i) => i.id)).toEqual([1, 3, 5]); // a parent outside the list leaves the sub-issue at the top
    expect(subIssues.get(1)?.map((i) => i.id)).toEqual([2, 4]);
  });
});
