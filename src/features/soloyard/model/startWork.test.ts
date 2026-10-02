import { describe, expect, it } from "vitest";
import type { IssueDetail } from "./issues";
import { startWorkPrompt } from "./startWork";

const issue: IssueDetail = {
  id: 1, project_id: 1, number: 1, ident: "SOL-1", title: "开工按钮", body_md: "详情页加开工。", status: "todo",
  priority: 2, labels: ["issues"], created_at: "", updated_at: "", completed_at: null, version: 1, children_done: 0,
  acceptance: [{ id: 1, text: "能开会话", done: 0, sort: 0 }, { id: 2, text: "带验收标准", done: 1, sort: 1 }],
  children: [], blockedBy: [{ id: 9, ident: "SOL-9", title: "前置", status: "todo" }], comments: [], sessions: [],
};

describe("startWorkPrompt", () => {
  it("includes the issue, acceptance checklist, project context, blockers and the reporting rule", () => {
    const prompt = startWorkPrompt(issue, { name: "Soloyard", goal: "独立开发者工作台" }, "/p/soloyard");
    expect(prompt.split("\n")[0]).toBe("开始处理 SOL-1：开工按钮");
    expect(prompt).toContain("- [ ] 能开会话\n- [x] 带验收标准");
    expect(prompt).toContain("项目：Soloyard（/p/soloyard）");
    expect(prompt).toContain("目标：独立开发者工作台");
    expect(prompt).toContain("未完成的前置 issue：SOL-9");
    expect(prompt).toContain("把 SOL-1 改成 in_progress");
    expect(prompt).toContain("把 SOL-1 改成 in_review");
  });

  it("omits empty sections", () => {
    const bare = startWorkPrompt({ ...issue, body_md: "", acceptance: [], labels: [], blockedBy: [] }, { name: "X" }, "/x");
    expect(bare).not.toContain("验收标准：");
    expect(bare).not.toContain("标签");
    expect(bare).not.toContain("前置");
  });
});
