/**
 * Soloyard：设置 → 连接 顶部的「手机同步」。连上家里主机的 Soloyard 网关后，
 * 这台电脑的会话推过去（手机上看得到、能在主机上接着聊），手机上的会话也能拿回来（会话列表顶上「在手机上」）。
 * 推送在 sidecar 里跑（soloyard/core/src/mirror.ts），这里只配地址和凭据、看状态。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { mutateSoloyard, useSoloyard } from "../data/api";

type SyncStatus = {
  connected: boolean;
  url: string | null;
  host: string | null;
  machine: string;
  pushedAt: number | null;
  error: string | null;
  sessions: number;
};

const INPUT = "w-full rounded-md border border-stroke bg-background-base px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/60";
const BUTTON = "shrink-0 rounded-md border border-stroke px-3 py-1.5 text-xs hover:bg-content/5 disabled:opacity-50";
const PAIR = "node soloyard/host/gateway.ts pair --name <name> --desktop";

export function SoloyardSyncSettings() {
  const { t, i18n } = useTranslation("soloyard");
  const { data: status, reload } = useSoloyard<SyncStatus>("syncStatus");
  useEffect(() => {
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [reload]);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(false);
    reload();
  };

  return (
    <section className="mb-10 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t("sync.title")}</h2>
        <p className="mt-1 text-xs text-content/55">{t("sync.description")}</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/3">
        {status?.connected ? (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className={`size-2 shrink-0 rounded-full ${status.error ? "bg-red-400" : "bg-emerald-400"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-content">{t("sync.connected", { host: status.host ?? status.url })}</div>
              <div className="truncate text-xs text-content/55" title={status.error ?? undefined}>
                {status.error
                  ? t("sync.error", { error: status.error })
                  : status.pushedAt
                    ? t("sync.pushed", {
                        count: status.sessions,
                        time: formatRelativeTime(new Date(status.pushedAt).toISOString(), Date.now(), i18n.language),
                      })
                    : t("sync.waiting")}
              </div>
              <div className="truncate font-mono text-[11px] text-content/40">
                {status.url} · {status.machine}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => void run(() => mutateSoloyard("disconnectSync"))} className={BUTTON}>
              {t("sync.disconnect")}
            </button>
          </div>
        ) : (
          <form
            className="space-y-2.5 px-4 py-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => mutateSoloyard("connectSync", url, token));
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs text-content/60">{t("sync.url")}</span>
              <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://100.x.y.z:3775" spellCheck={false} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-content/60">{t("sync.token")}</span>
              <input className={INPUT} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <p className="text-[11px] text-content/45">
              {t("sync.how")} <code className="font-mono text-content/60">{PAIR}</code>
            </p>
            <button type="submit" disabled={busy || !url.trim() || !token.trim()} className={BUTTON}>
              {busy ? t("sync.connecting") : t("sync.connect")}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
