import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../../i18n";
import type { IssueDetail } from "./issues";
import { startWorkPrompt } from "./startWork";

const issue: IssueDetail = {
  id: 1, project_id: 1, number: 1, ident: "SOL-1", title: "开工按钮", body_md: "详情页加开工。", status: "todo",
  priority: 2, labels: ["issues", "ui"], created_at: "", updated_at: "", completed_at: null, version: 1, children_done: 0, repo_path: null,
  acceptance: [{ id: 1, text: "能开会话", done: 0, sort: 0 }, { id: 2, text: "带验收标准", done: 1, sort: 1 }],
  children: [], blockedBy: [{ id: 9, ident: "SOL-9", title: "前置", status: "todo" }], comments: [], sessions: [],
};

describe("startWorkPrompt", () => {
  afterEach(() => i18n.changeLanguage("en"));

  it("includes the issue, acceptance checklist, project context, blockers and status rules (English UI)", () => {
    const prompt = startWorkPrompt(issue, { name: "Soloyard", goal: "Solo dev workbench" }, "/p/soloyard");
    expect(prompt.split("\n")[0]).toBe("Start working on SOL-1: 开工按钮");
    expect(prompt).toContain("Acceptance criteria:\n- [ ] 能开会话\n- [x] 带验收标准");
    expect(prompt).toContain("Project: Soloyard (/p/soloyard)");
    expect(prompt).toContain("Labels: issues, ui");
    expect(prompt).toContain("unfinished prerequisite issues: SOL-9");
    expect(prompt).toContain("set SOL-1 to in_progress");
    expect(prompt).toContain("Set SOL-1 to in_review");
  });

  it("follows the UI language", async () => {
    await i18n.changeLanguage("zh-CN");
    const prompt = startWorkPrompt(issue, { name: "Soloyard", goal: "独立开发者工作台" }, "/p/soloyard");
    expect(prompt.split("\n")[0]).toBe("开始处理 SOL-1：开工按钮");
    expect(prompt).toContain("项目：Soloyard（/p/soloyard）");
    expect(prompt).toContain("标签：issues、ui");
    expect(prompt).toContain("把 SOL-1 改成 in_progress");
  });

  it("names the member repo the session works in", () => {
    const prompt = startWorkPrompt({ ...issue, repo_path: "/ws/openroboto-backend" }, { name: "openroboto" }, "/ws");
    expect(prompt).toContain("Repository: openroboto-backend (/ws/openroboto-backend)");
    expect(startWorkPrompt(issue, { name: "openroboto" }, "/ws")).not.toContain("Repository:");
  });

  it("omits empty sections", () => {
    const bare = startWorkPrompt({ ...issue, body_md: "", acceptance: [], labels: [], blockedBy: [] }, { name: "X" }, "/x");
    expect(bare).not.toContain("Acceptance criteria:");
    expect(bare).not.toContain("Labels:");
    expect(bare).not.toContain("prerequisite");
  });
});
