import { describe, expect, it } from "vitest";
import { claudeMcpArgs, codexMcpConfig, type McpLaunch } from "./sessionMcp";

const launch: McpLaunch = { command: "/n/node", args: ["--no-warnings", "/app/soloyard/mcp/server.ts"], env: { SOLOYARD_DB: "/data/monocode.db" } };

describe("会话带上本版本的 Soloyard MCP", () => {
  it("Claude：--mcp-config 里一个叫 soloyard 的 stdio 服务，带本版本的库和 actor；不加 --strict-mcp-config", () => {
    const args = claudeMcpArgs(launch);
    expect(args[0]).toBe("--mcp-config");
    expect(JSON.parse(args[1])).toEqual({
      mcpServers: { soloyard: { type: "stdio", command: "/n/node", args: launch.args, env: { SOLOYARD_DB: "/data/monocode.db", SOLOYARD_ACTOR: "agent:claude-code" } } },
    });
    expect(args).not.toContain("--strict-mcp-config");
  });

  it("Codex：config 覆盖只换 mcp_servers.soloyard 这一项", () => {
    expect(codexMcpConfig(launch)).toEqual({
      "mcp_servers.soloyard": { command: "/n/node", args: launch.args, env: { SOLOYARD_DB: "/data/monocode.db", SOLOYARD_ACTOR: "agent:codex" } },
    });
  });

  it("拿不到启动方式时什么都不带，会话照常开", () => {
    expect(claudeMcpArgs(null)).toEqual([]);
    expect(codexMcpConfig(null)).toEqual({});
  });
});
