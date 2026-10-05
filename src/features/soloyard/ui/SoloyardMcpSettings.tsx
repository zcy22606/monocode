import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { MCP_PROVIDER_LABELS } from "../../settings/model/mcp";
import {
  loadMcpSettings,
  subscribeMcpSettings,
  type McpServerRow,
} from "../../settings/model/mcpSettingsCache";

/** Soloyard：设置 → MCP 顶部，Claude Code / Codex 接入 Soloyard MCP，清理原型 indie-desk 的残留。 */

type Provider = "claude" | "codex";
/** name：这个版本注册用的 MCP 名字（正式版 soloyard / 开发版 soloyard-dev，各自读写自己的库）。 */
type Status = { name: string; server: string; installed: Provider[]; legacyFiles: string[] };

const PROVIDERS: Provider[] = ["claude", "codex"];
const BUTTON =
  "shrink-0 rounded-md border border-stroke px-3 py-1.5 text-xs hover:bg-content/5 disabled:opacity-50";

export function SoloyardMcpSettings({ cwd }: { cwd: string }) {
  const { t } = useTranslation("soloyard");
  const [status, setStatus] = useState<Status | null>(null);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // 和下面底座的 MCP 列表共用一份发现结果，这里改了那边也跟着刷新。
  const refresh = useCallback(
    async (force: boolean) => {
      const [next, snapshot] = await Promise.all([
        invoke<Status>("soloyard_agents_status"),
        loadMcpSettings(cwd, force),
      ]);
      setServers(snapshot.servers);
      setStatus(next);
    },
    [cwd],
  );
  useEffect(
    () => subscribeMcpSettings(cwd, (snapshot) => setServers(snapshot.servers)),
    [cwd],
  );
  useEffect(() => {
    refresh(false).catch((cause) => setError(String(cause)));
  }, [refresh]);

  const has = (provider: Provider, name: string) =>
    servers.some(
      (s) => s.provider === provider && s.scope === "user" && s.name === name,
    );
  const legacyMcp = PROVIDERS.filter((p) => has(p, "indie-desk"));
  const legacy = status
    ? [
        ...legacyMcp.map((p) => t("mcp.legacyMcp", { agent: MCP_PROVIDER_LABELS[p] })),
        ...status.legacyFiles,
      ]
    : [];

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    }
    await refresh(true).catch((cause) => setError(String(cause)));
    setBusy("");
  }

  return (
    <section className="mb-10 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t("mcp.title")}</h2>
        <p className="mt-1 text-xs text-content/55">{t("mcp.description")}</p>
        {status ? (
          <p className="mt-1 truncate font-mono text-[11px] text-content/40" title={status.server}>
            {status.server}
          </p>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/3">
        {PROVIDERS.map((provider) => {
          const installed = status?.installed.includes(provider) ?? false;
          const connected = !!status && has(provider, status.name);
          return (
            <div
              key={provider}
              className="flex items-center gap-3 border-b border-content/5 px-4 py-3.5 last:border-b-0"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
                <HarnessIcon harness={provider} className="size-3.5 shrink-0" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-content">
                  {MCP_PROVIDER_LABELS[provider]}
                </div>
                <div className="text-xs text-content/55">
                  {!status
                    ? t("mcp.checking")
                    : !installed
                      ? t("mcp.notInstalled")
                      : connected
                        ? t("mcp.connected")
                        : t("mcp.notConnected")}
                </div>
              </div>
              <button
                type="button"
                disabled={!installed || busy !== ""}
                onClick={() =>
                  void run(provider, () =>
                    connected
                      ? invoke("soloyard_mcp_remove", { provider, name: status?.name })
                      : invoke("soloyard_mcp_connect", { provider }),
                  )
                }
                className={BUTTON}
              >
                {connected ? t("mcp.disconnect") : t("mcp.connect")}
              </button>
            </div>
          );
        })}
        {legacy.length ? (
          <div className="flex items-start gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-content">
                {t("mcp.legacyTitle")}
              </div>
              <p className="text-xs text-content/55">{t("mcp.legacyDescription")}</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-content/45">
                {legacy.map((item) => (
                  <li key={item} className="truncate" title={item}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() =>
                void run("legacy", async () => {
                  for (const provider of legacyMcp)
                    await invoke("soloyard_mcp_remove", { provider, name: "indie-desk" });
                  await invoke("soloyard_legacy_cleanup");
                })
              }
              className={BUTTON}
            >
              {t("mcp.legacyCleanup")}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
