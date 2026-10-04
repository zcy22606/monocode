/**
 * 迭代原型的内存状态（mock，不落库）：版本顺序、每个功能在哪个版本、哪些功能建了 issue。
 * 放在模块里，切换标签不丢；重启应用复原。确认原型后换成真实数据层。
 */
import { useSyncExternalStore } from "react";
import type { IssueStatus } from "../model/issues";
import { MOCK_FEATURES, MOCK_ITERATIONS, type MockIteration } from "./iterationsMock";

type State = {
  iterations: MockIteration[];
  placement: Record<string, string>;
  issues: Record<string, { ident: string; status: IssueStatus }>;
  nextIssue: number;
};

let state: State = {
  iterations: MOCK_ITERATIONS,
  placement: Object.fromEntries(MOCK_FEATURES.map((f) => [f.code, f.ai])),
  // 演示「进行中」的 v0.1：已经开工，前几个功能有 issue
  issues: Object.fromEntries(
    MOCK_FEATURES.filter((f) => f.ai === "v0.1").map((f, i) => [f.code, { ident: `SOL-${100 + i}`, status: (i < 8 ? "done" : i < 14 ? "in_progress" : "todo") as IssueStatus }]),
  ),
  nextIssue: 200,
};
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

export function useIterationsMock() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

/** 非 React 场景（测试）读当前状态。 */
export const iterationsSnapshot = () => state;
export const releases = (s: State) => s.iterations.filter((i) => i.kind === "release");
/** 已完成的迭代锁定：功能不能拖进拖出。 */
export const locked = (s: State, id: string | undefined) => s.iterations.some((i) => i.id === id && i.status === "done");
/** 没做完 = 还没有 issue，或 issue 既没完成也没取消。 */
export const unfinished = (s: State, code: string) => !s.issues[code] || !["done", "canceled"].includes(s.issues[code].status);

export const mockActions = {
  /** 减法 / 重新排期：把功能挪到另一个版本（或「待定」「另立项」「不做」）。已完成的迭代锁定，进出都不行。 */
  move(code: string, iterationId: string) {
    if (locked(state, state.placement[code]) || locked(state, iterationId)) return;
    set({ ...state, placement: { ...state.placement, [code]: iterationId } });
  },
  /** 调整优先级：版本按顺序排，只在正常版本之间调。 */
  reorder(id: string, beforeId: string | null) {
    const rel = releases(state).filter((i) => i.id !== id);
    const moving = state.iterations.find((i) => i.id === id)!;
    const at = beforeId ? rel.findIndex((i) => i.id === beforeId) : rel.length;
    rel.splice(at < 0 ? rel.length : at, 0, moving);
    set({ ...state, iterations: [...rel, ...state.iterations.filter((i) => i.kind !== "release")] });
  },
  /** 开始迭代：给勾选的功能各建一个 issue（一个功能一个），状态改成进行中。 */
  start(id: string, codes: string[]) {
    const issues = { ...state.issues };
    let next = state.nextIssue;
    for (const code of codes) {
      if (state.placement[code] === id && !issues[code]) issues[code] = { ident: `SOL-${next++}`, status: "todo" };
    }
    set({ ...state, issues, nextIssue: next, iterations: state.iterations.map((i) => (i.id === id ? { ...i, status: "active" } : i)) });
  },
  /** 完成迭代：没做完的功能按 moves 挪走，冻结统计，迭代锁定。 */
  finish(id: string, moves: Record<string, string>) {
    const done = Object.entries(state.placement).filter(([code, where]) => where === id && !moves[code]).length;
    const moved = Object.keys(moves).length;
    set({
      ...state,
      placement: { ...state.placement, ...moves },
      iterations: state.iterations.map((i) => (i.id === id ? { ...i, status: "done", summary: { done, moved } } : i)),
    });
  },
  /** 重新打开：回到进行中，解除锁定；完成时挪走的功能不会自动回来。 */
  reopen(id: string) {
    set({ ...state, iterations: state.iterations.map((i) => (i.id === id ? { ...i, status: "active", summary: undefined } : i)) });
  },
  /** 单独给某个功能建 issue（不必开始整个迭代）。 */
  createIssue(code: string) {
    if (state.issues[code]) return;
    set({ ...state, issues: { ...state.issues, [code]: { ident: `SOL-${state.nextIssue}`, status: "todo" } }, nextIssue: state.nextIssue + 1 });
  },
  /** 新建迭代：beforeId = 插在哪个版本前面（null = 排最后，优先级最低）。 */
  add(input: IterationInput, beforeId: string | null): string {
    const id = `it-${Date.now()}`;
    const rel = releases(state);
    const at = beforeId ? rel.findIndex((i) => i.id === beforeId) : -1;
    rel.splice(at < 0 ? rel.length : at, 0, { id, ...input, status: "planned", kind: "release" });
    set({ ...state, iterations: [...rel, ...state.iterations.filter((i) => i.kind !== "release")] });
    return id;
  },
  update(id: string, patch: Partial<IterationInput>) {
    set({ ...state, iterations: state.iterations.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  },
  /** 删除迭代：里面的功能（连同已建的 issue）挪到 moveTo。返回删除前后的状态，给「撤销」用。 */
  remove(id: string, moveTo: string): { prev: State; next: State } {
    const prev = state;
    const placement = Object.fromEntries(Object.entries(state.placement).map(([code, where]) => [code, where === id ? moveTo : where]));
    set({ ...state, placement, iterations: state.iterations.filter((i) => i.id !== id) });
    return { prev, next: state };
  },
  restore(prev: State) {
    set(prev);
  },
};

export type IterationInput = Pick<MockIteration, "version" | "name" | "goal" | "targetDate">;
export type IterationsState = State;

const parseVersion = (v: string) => {
  const m = /^v?(\d+)(?:\.(\d+))?/i.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
};

/** 版本号查重：忽略大小写和前缀 v（v1.0 和 1.0 算同一个）。 */
export function versionTaken(iterations: MockIteration[], version: string, exceptId?: string) {
  const norm = (v: string) => v.trim().toLowerCase().replace(/^v/, "");
  return iterations.some((i) => i.id !== exceptId && i.version && norm(i.version) === norm(version));
}

/** 建议的下一个版本号：在现有最大版本上 +0.1（小版本）或 +1.0（大版本），已被占用就继续往上加。 */
export function suggestVersions(iterations: MockIteration[]): { minor: string; major: string } {
  const [maj, min] = iterations.map((i) => parseVersion(i.version)).filter((v) => v !== null).reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a), [0, 0]);
  const free = (make: (n: number) => string) => {
    for (let n = 1; ; n++) if (!versionTaken(iterations, make(n))) return make(n);
  };
  return { minor: free((n) => `v${maj}.${min + n}`), major: free((n) => `v${maj + n}.0`) };
}

/** 原型里的「重置」：回到 AI 的原始安排。 */
const initial = state;
export const resetIterationsMock = () => set(initial);
