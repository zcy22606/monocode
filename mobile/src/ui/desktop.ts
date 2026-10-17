/**
 * 和电脑上用同一份的界面零件（SOL-96）：图标、模型 logo、终端式转圈、流光文字、项目小人、工具类型判断，
 * 直接引电脑的源码，电脑上改了手机跟着变。这些模块不碰 Tauri、不碰电脑的 i18n。
 * 电脑上没导出、或者连着电脑 i18n 的几个小函数（时间格式、项目默认颜色）在下面照抄一份，改的时候两边一起改。
 */
import type { Block } from "../host/host";
import { t } from "../i18n";
import { displayPath } from "../../../src/shared/lib/paths";
import {
  composeToolTitle,
  isAgentTool,
  isEditTool,
  isExecuteTool,
  isReadTool,
  isSearchTool,
} from "../../../src/integrations/harness/core/preview";

export { HarnessIcon } from "../../../src/features/sessions/ui/HarnessIcon";
export { TerminalSpinner } from "../../../src/features/sessions/ui/TerminalSpinner";
export { Shimmer } from "../../../src/shared/ui/Shimmer";
export { ProjectMascot } from "../../../src/features/projects/ui/ProjectMascot";
export { FileTypeIcon } from "../../../src/features/files/ui/FileTypeIcon";

/** 电脑上 transcriptActivity.ts 的 toolCallLabel：工具调用那一行的字，路径相对会话目录。 */
export function toolLabel(block: Block, cwd?: string) {
  const preview = block.tool?.preview;
  const path = preview?.path ? displayPath(preview.path, cwd) : preview?.fileName;
  return (
    composeToolTitle({ kind: block.tool?.kind, title: block.text || block.tool?.title, path, query: preview?.query, previewKind: preview?.kind, cwd }) ||
    t("session.tool")
  );
}

/** 电脑上 resolveToolCallDisplay 的拆法：只有这几个动作拆成「动作 + 目标」，命令之类整行等宽。 */
export function splitToolLabel(label: string) {
  const [, action, target] = label.match(/^(Read|Find|Skill|List|Edit|Write)\s+(.+)$/) ?? [];
  return { action, target, isFile: !!action && action !== "Find" && action !== "Skill" };
}

/** 电脑上 transcriptActivity.ts 的 toolCategory：工具调用按类型配图标。 */
export type ToolKind = "edit" | "research" | "run" | "agent" | "other";
export function toolKind(block: Block, label: string): ToolKind {
  const kind = block.tool?.kind;
  const title = block.text || block.tool?.title;
  const preview = block.tool?.preview;
  if (isAgentTool(kind, title)) return "agent";
  if (isEditTool(kind, title, preview)) return "edit";
  if (isSearchTool(kind, title, preview)) return "research";
  if (isReadTool(kind, title, preview)) return "research";
  if (/^(?:Edit|Write)\s+\S/i.test(label)) return "edit";
  if (/^(?:Read|List|Find)\b/i.test(label)) return "research";
  if (isExecuteTool(kind, title)) return "run";
  return "other";
}

/** 电脑上 AgentTranscript.tsx 的 formatElapsed：12s / 1m 5s / 12m。 */
export function formatElapsed(ms: number) {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** 电脑上 AgentTranscript.tsx 的 formatClockTime：用户消息下面的时间。 */
export const formatClockTime = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** 电脑上 AgentTranscript.tsx 的 dayStamp：对话里换了一天时的分隔。 */
export function dayStamp(at: number, now = Date.now()): [string, string] {
  const date = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const day =
    date.toDateString() === today.toDateString()
      ? t("time.today")
      : date.toDateString() === yesterday.toDateString()
        ? t("time.yesterday")
        : new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
          }).format(at);
  return [day, formatClockTime(at)];
}

/** 电脑侧栏的 formatRelative：刚刚 / 5 分钟 / 3 小时 20 分钟 / 2 天 / 10月14日。 */
export function formatRelative(value: number, now = Date.now()) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return t("relative.now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("relative.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? t("relative.hoursMinutes", { hours, minutes: rest }) : t("relative.hours", { hours });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return t("relative.days", { days });
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

/** 电脑上 tabGroups.ts 的 tabGroupColor：项目没设颜色时按名字算一个。 */
const TAB_GROUP_COLORS = [
  "hsl(210 8% 58%)",
  "hsl(211 92% 62%)",
  "hsl(12 80% 58%)",
  "hsl(45 90% 55%)",
  "hsl(142 55% 50%)",
  "hsl(330 70% 62%)",
  "hsl(280 55% 62%)",
  "hsl(175 55% 48%)",
  "hsl(25 85% 58%)",
];
export function projectColor(project: string) {
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return TAB_GROUP_COLORS[(hash % (TAB_GROUP_COLORS.length - 1)) + 1];
}
