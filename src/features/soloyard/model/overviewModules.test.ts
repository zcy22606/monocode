import { describe, expect, it } from "vitest";
import type { IterationPlan } from "./iterations";
import { issueCounts, iterationSummary } from "./overview";

const plan = (iterations: Partial<IterationPlan["iterations"][number]>[], features: Partial<IterationPlan["features"][number]>[]) =>
  ({ iterations, features, backbones: {} }) as unknown as IterationPlan;

describe("主页模块卡片的统计", () => {
  it("当前迭代：排在最前的进行中迭代，只数建了 issue 的功能；没有进行中就看下一个计划中的", () => {
    const p = plan(
      [{ id: 1, tag: "v0.0", status: "done" }, { id: 2, tag: "v0.1", name: "骨架", status: "active" }, { id: 3, tag: "v0.2", status: "planned" }],
      [
        { iteration_id: 2, issue_id: 10, issue_status: "done" },
        { iteration_id: 2, issue_id: 11, issue_status: "canceled" },
        { iteration_id: 2, issue_id: 12, issue_status: "todo" },
        { iteration_id: 2, issue_id: null, issue_status: null },
        { iteration_id: 3, issue_id: 13, issue_status: "done" },
      ],
    );
    expect(iterationSummary(p)).toEqual({ tag: "v0.1", name: "骨架", active: true, done: 2, total: 3 });
    const notStarted = plan([{ id: 3, tag: "v0.2", name: "", status: "planned" }], []);
    expect(iterationSummary(notStarted)).toMatchObject({ tag: "v0.2", active: false, total: 0 });
    expect(iterationSummary(plan([], []))).toBeNull();
    expect(iterationSummary(undefined)).toBeNull();
  });

  it("Issues：只数顶层的待办、进行中、待验收", () => {
    expect(
      issueCounts([
        { status: "todo", parent_id: null },
        { status: "todo", parent_id: 1 },
        { status: "in_progress", parent_id: null },
        { status: "in_review", parent_id: null },
        { status: "in_review", parent_id: null },
        { status: "done", parent_id: null },
        { status: "backlog", parent_id: null },
      ]),
    ).toEqual({ todo: 1, inProgress: 1, inReview: 2 });
    expect(issueCounts(undefined)).toEqual({ todo: 0, inProgress: 0, inReview: 0 });
  });
});
