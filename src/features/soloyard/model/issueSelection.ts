/**
 * Issues 列表 / 看板的多选，按底座侧栏的习惯：⌘ / Ctrl 点击（或勾选框）加减一条，
 * Shift 点击从锚点选到这一条（再按 ⌘ 是追加），普通点击由调用方打开 issue。
 */
export type IssueSelection = { ids: Set<number>; anchor: number | null };

export const EMPTY_SELECTION: IssueSelection = { ids: new Set(), anchor: null };

/** order：当前可见的 issue 顺序（按标签分组时同一条可能出现多次，取第一次）。 */
export function selectIssue(
  current: IssueSelection,
  id: number,
  order: number[],
  mods: { shift?: boolean; toggle?: boolean },
): IssueSelection {
  if (mods.shift) {
    const anchor = current.anchor != null && order.includes(current.anchor) ? current.anchor : id;
    const [start, end] = [order.indexOf(anchor), order.indexOf(id)].sort((a, b) => a - b);
    const range = order.slice(start, end + 1);
    return { ids: new Set(mods.toggle ? [...current.ids, ...range] : range), anchor };
  }
  const ids = new Set(current.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: ids.size ? id : null };
}
