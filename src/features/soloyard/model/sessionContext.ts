/**
 * Soloyard：会话关联按需注入 + 项目地图。
 * - 输入框里用 @link/SOL-5 这样引用关联对象；App 发送前调 soloyardTurnContext，只把 @ 到的内容附在消息后面。
 * - 同时缓存额外的文件夹（关联的文件夹 + 项目的成员仓库），Claude（--add-dir）和 Codex（可写目录）
 *   启动 / 开新一轮时从这里取——这是权限，不占上下文。
 * - 项目地图（成员仓库 + 项目说明）放进系统提示：Claude 的 --append-system-prompt、Codex 的 developerInstructions，
 *   进程启动时带上；改了说明对新会话 / 下次重启生效，不为它重启正在聊的进程。
 */
import { soloyardCall } from "../data/api";

type SessionContext = { dirs: string[]; text: string; map?: string };

const dirsBySession = new Map<string, string[]>();
const mapBySession = new Map<string, string>();

export const soloyardExtraDirs = (sessionId: string): string[] =>
  dirsBySession.get(sessionId) ?? [];

/** Claude 启动参数：每个额外目录一个 --add-dir。目录变了会改 settingsKey，Claude 带 --resume 重启。 */
export const soloyardClaudeAddDirArgs = (sessionId: string): string[] =>
  soloyardExtraDirs(sessionId).flatMap((dir) => ["--add-dir", dir]);

/** Claude 启动参数：项目地图追加到系统提示。 */
export const soloyardClaudeSystemPromptArgs = (sessionId: string): string[] => {
  const map = mapBySession.get(sessionId);
  return map ? ["--append-system-prompt", map] : [];
};

/** Codex thread/start、thread/resume：项目地图作为开发者指令。 */
export const soloyardCodexInstructions = (sessionId: string): { developerInstructions?: string } => {
  const map = mapBySession.get(sessionId);
  return map ? { developerInstructions: map } : {};
};

/** Codex turn/start：可写沙箱里加上额外目录（只读 / 全权限模式不用管）。 */
export function withSoloyardWritableRoots(
  params: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown> {
  const dirs = soloyardExtraDirs(sessionId);
  const policy = params.sandboxPolicy as { type?: string } | undefined;
  if (!dirs.length || policy?.type !== "workspaceWrite") return params;
  return { ...params, sandboxPolicy: { ...policy, writableRoots: dirs } };
}

/** @ 到的关联内容 → 附在消息末尾的那段；纯函数，方便测试。 */
export function contextBlock(text: string): string {
  return text ? `\n\n<soloyard_context>\nItems the user referenced with @link above:\n\n${text}\n</soloyard_context>` : "";
}

/** 发送前调用：刷新额外目录和项目地图，返回要附在消息末尾的文字（没 @ 关联就是空串）。 */
export async function soloyardTurnContext(sessionId: string, message: string, cwd?: string, workCwd?: string): Promise<string> {
  let context: SessionContext;
  try {
    context = await soloyardCall<SessionContext>("sessionContext", sessionId, message, cwd, workCwd);
  } catch {
    return ""; // 数据进程没起来不挡发送
  }
  dirsBySession.set(sessionId, context.dirs);
  if (context.map) mapBySession.set(sessionId, context.map);
  else mapBySession.delete(sessionId);
  return contextBlock(context.text);
}
