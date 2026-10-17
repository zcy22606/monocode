/**
 * 工具调用合成一段（照电脑 transcriptActivity.ts 的 groupTurnItems / tallySteps / workSummaryLine）：
 * 连着的工具调用、状态行合成一段，标题是「已读取 3 个文件 · 运行了 2 个命令」；文字、思考、等你批的单独成行。
 * 电脑那份连着电脑的 i18n 和别的模块，手机引不了，照抄一份，改的时候两边一起改。文案也照搬（locales 的 activity.*）。
 */
import type { Block } from "../host/host";
import { t } from "../i18n";
import { toolKind, toolLabel, type ToolKind } from "./desktop";

export type WorkItem = { block: Block; index: number } | { steps: Block[]; index: number };

const isTool = (b: Block) => b.role === "tool" || b.role === "approval";
const waitingApproval = (b: Block) => !!b.approval && !b.approval.decided;
/** 系统行里的错误、中断这类提醒自己成行；别的（状态更新）算工作里的一步。 */
const isNotice = (b: Block) => b.role === "system" && (!!b.notice || /interrupted/i.test(b.text));
const isWork = (b: Block) => (isTool(b) && !waitingApproval(b)) || (b.role === "system" && !b.interjection && !isNotice(b));

/** 连着的工作合成一段；index 是这一项第一块在原列表里的位置（日期分隔、入场动画用）。 */
export function groupWork(blocks: Block[]): WorkItem[] {
  const items: WorkItem[] = [];
  let steps: Block[] = [];
  let start = 0;
  const flush = () => {
    if (steps.length) items.push({ steps, index: start });
    steps = [];
  };
  blocks.forEach((block, index) => {
    if (isWork(block)) {
      if (!steps.length) start = index;
      steps.push(block);
      return;
    }
    flush();
    items.push({ block, index });
  });
  flush();
  return items;
}

const ORDER: ToolKind[] = ["edit", "run", "agent", "research", "other"];

/** 这一段做得最多的那类（同样多时改过的优先），配标题前的图标。 */
export function workKind(steps: Block[]): ToolKind | "note" {
  const counts = new Map<ToolKind, number>();
  for (const b of steps) {
    if (!isTool(b)) continue;
    const kind = toolKind(b, toolLabel(b));
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: ToolKind | undefined;
  for (const kind of ORDER) if ((counts.get(kind) ?? 0) > 0 && (!best || counts.get(kind)! > counts.get(best)!)) best = kind;
  return best ?? "note";
}

const RUNNING = /^(running|pending|in_progress|started)$/i;
const leaf = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const files = (set: Set<string>) => (set.size === 1 ? leaf([...set][0]) : t("activity.files", { count: set.size }));

/** 这一段的标题。live = 正在跑，正在做的那类用进行时（「正在运行 2 个命令」，跑完变「运行了 2 个命令」）。 */
export function workSummary(steps: Block[], live = false): string {
  const order: ToolKind[] = [];
  const reads = new Set<string>();
  const edits = new Set<string>();
  let searches = 0;
  let runs = 0;
  let background = 0;
  let backgroundLive = 0;
  let agents = 0;
  let others = 0;
  let current: ToolKind | undefined;
  for (const b of steps) {
    if (!isTool(b)) continue;
    const label = toolLabel(b);
    const kind = toolKind(b, label);
    current = kind;
    if (!order.includes(kind)) order.push(kind);
    const target = b.tool?.preview?.path ?? b.tool?.preview?.fileName ?? label.match(/^(?:Read|List|Edit|Write)\s+(.+)$/i)?.[1] ?? b.id;
    if (kind === "edit") edits.add(target);
    else if (kind === "agent") agents += 1;
    else if (kind === "run") {
      // 后台行是同一条命令在等它跑完，说的是在等什么，不算又跑了一条
      if (b.tool?.background) {
        background += 1;
        if (RUNNING.test(b.tool.status ?? "")) backgroundLive += 1;
      } else runs += 1;
    } else if (kind === "research") {
      if (/^Find\b/i.test(label) || b.tool?.preview?.kind === "search") searches += 1;
      else reads.add(target);
    } else others += 1;
  }
  if (!order.length) return steps.every((b) => b.role === "system") ? t("activity.statusUpdate") : live ? t("activity.thinking") : t("activity.thought");
  const running = live ? current : undefined;
  return order
    .map((kind) => {
      const now = kind === running;
      switch (kind) {
        case "edit":
          return t(now ? "activity.editing" : "activity.edited", { target: files(edits) });
        case "research":
          if (reads.size && !searches) return t(now ? "activity.reading" : "activity.read", { target: files(reads) });
          if (!reads.size) return t(now ? "activity.searching" : "activity.searched");
          return t(now ? "activity.exploring" : "activity.explored");
        case "run":
          if (backgroundLive) return t("activity.runningBackground");
          if (!runs && background) return t("activity.finishedBackground");
          return t(now ? "activity.runningCommands" : "activity.ranCommands", { count: runs });
        case "agent":
          return t(now ? "activity.runningSubagents" : "activity.ranSubagents", { count: agents });
        default:
          return t(now ? "activity.runningTools" : "activity.ranTools", { count: others });
      }
    })
    .join(" · ");
}
