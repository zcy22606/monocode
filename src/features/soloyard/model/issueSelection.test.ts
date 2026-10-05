import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, selectIssue } from "./issueSelection";

const order = [5, 3, 8, 1, 9];
const ids = (s: { ids: Set<number> }) => [...s.ids];

describe("selectIssue", () => {
  it("toggles one issue at a time and sets the anchor", () => {
    let s = selectIssue(EMPTY_SELECTION, 3, order, { toggle: true });
    s = selectIssue(s, 1, order, { toggle: true });
    expect(ids(s)).toEqual([3, 1]);
    expect(s.anchor).toBe(1);
    s = selectIssue(s, 1, order, { toggle: true });
    s = selectIssue(s, 3, order, { toggle: true });
    expect(s).toEqual({ ids: new Set(), anchor: null });
  });

  it("shift selects the visible range from the anchor in either direction", () => {
    const s = selectIssue(EMPTY_SELECTION, 8, order, { toggle: true });
    expect(ids(selectIssue(s, 9, order, { shift: true }))).toEqual([8, 1, 9]);
    expect(ids(selectIssue(s, 5, order, { shift: true }))).toEqual([5, 3, 8]);
  });

  it("shift replaces the selection, shift+⌘ adds to it", () => {
    let s = selectIssue(EMPTY_SELECTION, 5, order, { toggle: true });
    s = selectIssue(s, 9, order, { toggle: true });
    expect(ids(selectIssue(s, 8, order, { shift: true }))).toEqual([8, 1, 9]);
    expect(ids(selectIssue(s, 8, order, { shift: true, toggle: true })).sort()).toEqual([1, 5, 8, 9]);
  });

  it("shift without a visible anchor selects just the clicked issue", () => {
    expect(ids(selectIssue({ ids: new Set([42]), anchor: 42 }, 1, order, { shift: true }))).toEqual([1]);
  });
});
