/**
 * Soloyard：会话列表顶上的「在手机上」——服务器上这个项目的会话（手机上开在服务器上的）。
 * 点一下拿回这台电脑接着聊：服务器上归档，这里新开一个会话续上原来的 Claude Code / Codex 对话（SOL-89）。
 * 没配手机同步时什么也不显示。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { ChevronDown, ChevronUp, Loader, Smartphone } from "../../../../shared/ui/icons";
import { formatRelativeTime } from "../../../inbox/model/githubTasks";
import { mutateSoloyard, useSoloyard } from "../../data/api";
import { requestStartWork } from "../../model/appActions";
import { seedFromHost, type HostSessionRow, type TakenSession } from "../../model/hostSessions";

const COLLAPSED = 3;

/** 拿回来：主机上归档，在这台电脑上新开一个会话续上原来的对话。 */
async function takeBack(cwd: string, row: HostSessionRow) {
  const { session } = await mutateSoloyard<TakenSession>("takeHostSession", row.id);
  requestStartWork({ cwd, sessionId: crypto.randomUUID(), prompt: "", seed: seedFromHost(session) });
}

/** 手机上的动静网关不会通知电脑，隔一会儿问一次（同一个项目的几处共用一次请求）。 */
function useHostSessions(cwd: string) {
  const { data, reload } = useSoloyard<HostSessionRow[]>("hostSessions", cwd);
  useEffect(() => {
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);
  return data ?? [];
}

export function HostSessions({ cwd }: { cwd: string }) {
  const { t, i18n } = useTranslation("soloyard");
  const rows = useHostSessions(cwd);
  const [expanded, setExpanded] = useState(false);
  const [taking, setTaking] = useState<string>();
  const [error, setError] = useState<string>();
  if (!rows.length) return null;
  const extra = rows.length - COLLAPSED;
  const visible = expanded || extra <= 0 ? rows : rows.slice(0, COLLAPSED);

  const take = async (row: HostSessionRow) => {
    setTaking(row.id);
    setError(undefined);
    try {
      await takeBack(cwd, row);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaking(undefined);
    }
  };

  return (
    <div className="mx-1 mt-1.5 shrink-0 border-b border-stroke pb-1">
      <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1 text-xs text-content/50" title={t("hostSessions.hint")}>
        <Smartphone className="size-3" strokeWidth={1.75} />
        {t("hostSessions.label")}
      </div>
      <div className={`flex flex-col gap-px ${expanded ? "max-h-[30vh] overflow-y-auto overscroll-none" : ""}`}>
        {visible.map((row) => {
          const running = row.status === "running";
          return (
            <button
              key={row.id}
              type="button"
              disabled={running || !!taking}
              title={running ? t("hostSessions.running") : t("hostSessions.take")}
              onClick={() => void take(row)}
              className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-content/8 disabled:hover:bg-transparent"
            >
              {taking === row.id ? (
                <Loader className="size-2.5 shrink-0 animate-spin text-content/50" />
              ) : (
                <span className={`size-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-accent" : row.needsInput ? "bg-amber-400" : "bg-content/25"}`} />
              )}
              <span className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${running ? "text-content/55" : ""}`}>{row.title}</span>
              <span className="shrink-0 text-[11px] text-content/40">
                {running
                  ? t("hostSessions.runningShort")
                  : row.needsInput
                    ? t("hostSessions.needsInput")
                    : formatRelativeTime(new Date(row.updatedAt).toISOString(), Date.now(), i18n.language)}
              </span>
            </button>
          );
        })}
      </div>
      {extra > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-center gap-1 px-2 py-1 text-[11px] text-content/50 hover:bg-content/8 hover:text-content"
        >
          {expanded ? <ChevronUp className="size-3" strokeWidth={1.75} /> : <ChevronDown className="size-3" strokeWidth={1.75} />}
          {expanded ? t("hostSessions.showLess") : t("hostSessions.more", { count: extra })}
        </button>
      ) : null}
      {error ? <p className="px-2.5 pb-1 text-[11px] text-red-400">{t("hostSessions.failed", { error })}</p> : null}
    </div>
  );
}

