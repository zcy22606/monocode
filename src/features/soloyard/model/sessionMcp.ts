/**
 * Soloyard：应用开的会话自动带上本版本的 Soloyard MCP（本版本的服务脚本、本版本的库），会话参数里传，不写用户配置。
 * 名字一律叫 soloyard：会话参数里的同名项会整个盖过用户配置里的（Claude Code 2.1 / Codex 0.162 实测），
 * 所以开发版的会话只看到开发版自己的库，正式版的只看到正式版的。设置里的「接入」只给终端里直接跑的会话用。
 */
import { invoke } from "@tauri-apps/api/core";

export type McpLaunch = { command: string; args: string[]; env: Record<string, string> };

let launch: Promise<McpLaunch | null> | null = null;
/** 拿一次就缓存；拿不到（找不到 node 等）就不带，会话照常开。 */
function soloyardMcp() {
  launch ??= invoke<McpLaunch>("soloyard_mcp_launch").catch((e) => {
    console.warn("soloyard MCP unavailable for sessions", e);
    return null;
  });
  return launch;
}

const withActor = (l: McpLaunch, actor: string) => ({ command: l.command, args: l.args, env: { ...l.env, SOLOYARD_ACTOR: actor } });

/** Claude：`--mcp-config`（不加 --strict-mcp-config，用户自己的 MCP 照样在）。 */
export const claudeMcpArgs = (l: McpLaunch | null): string[] =>
  l ? ["--mcp-config", JSON.stringify({ mcpServers: { soloyard: { type: "stdio", ...withActor(l, "agent:claude-code") } } })] : [];

/** Codex：thread/start、thread/resume 的 config 覆盖（点分路径，只换这一项）。 */
export const codexMcpConfig = (l: McpLaunch | null): Record<string, unknown> =>
  l ? { "mcp_servers.soloyard": withActor(l, "agent:codex") } : {};

export const soloyardClaudeMcpArgs = async () => claudeMcpArgs(await soloyardMcp());
export const soloyardCodexMcpConfig = async () => codexMcpConfig(await soloyardMcp());
