import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../../i18n";
import type { IssueDetail } from "./issues";
import { canStart, leadPrompt, startsByDefault } from "./parallelStart";

const child = (id: number, patch: Partial<IssueDetail["children"][number]>) => ({
  id, ident: `WS-${id}`, title: `t${id}`, status: "todo" as const, priority: 0, repo_path: null, blocked: 0, labels: [] as string[], ...patch,
});
const parent: IssueDetail = {
  id: 1, project_id: 1, number: 1, ident: "WS-1", title: "改协议", body_md: "协议 v2。", status: "todo", priority: 2, labels: [],
  created_at: "", updated_at: "", completed_at: null, version: 1, children_done: 0, repo_path: null, parent_id: null, parked: 0,
  acceptance: [{ id: 1, text: "端到端跑通", done: 0, sort: 0 }],
  children: [
    child(2, { title: "协议", repo_path: "/ws/protocol" }),
    child(3, { title: "后端", repo_path: "/ws/backend", blocked: 1 }),
    child(4, { title: "文档", status: "in_progress" }),
    child(5, { title: "旧方案", status: "canceled" }),
    child(6, { title: "待 Cam 确认", labels: ["human"] }),
    child(7, { title: "加密", status: "backlog", repo_path: "/ws/backend" }),
  ],
  parent: null, blockedBy: [], comments: [], sessions: [],
};

describe("parallel start", () => {
  afterEach(() => i18n.changeLanguage("en"));

  it("only offers sub-issues that haven't started, aren't waiting on prerequisites and aren't the user's to do; backlog ones aren't checked by default", () => {
    expect(parent.children.filter(canStart).map((c) => c.id)).toEqual([2, 7]);
    expect(parent.children.filter(startsByDefault).map((c) => c.id)).toEqual([2]);
  });

  it("tells the lead what started where, what still waits, and how to integrate", () => {
    const prompt = leadPrompt(parent, [parent.children[0]], { name: "openroboto" }, "/ws");
    expect(prompt.split("\n")[0]).toContain("lead session for WS-1: 改协议");
    expect(prompt).toContain("协议 v2。");
    expect(prompt).toContain("- [ ] 端到端跑通");
    expect(prompt).toContain("- WS-2 协议 — in protocol (new worktree)");
    expect(prompt).toContain("- WS-3 后端 — in backend (new worktree) (waiting on prerequisites)");
    expect(prompt).toContain("- WS-4 文档 — at the project root");
    expect(prompt).not.toContain("旧方案");
    expect(prompt).toContain("- WS-6 待 Cam 确认 — at the project root (needs me)");
    expect(prompt).toContain("Accepting it merges its branch");
    expect(prompt).toContain("set WS-1 to in_review");
  });

  it("follows the UI language", async () => {
    await i18n.changeLanguage("zh-CN");
    const prompt = leadPrompt(parent, [parent.children[0]], { name: "openroboto" }, "/ws");
    expect(prompt.split("\n")[0]).toBe("你是 WS-1「改协议」的主会话，负责协调；子任务在各自的会话里做，你不要亲自去做。");
    expect(prompt).toContain("- WS-2 协议 — 在 protocol（新工作树）");
  });
});
