/**
 * 头脑风暴时的侧栏：盖在工作区面板上，样子和会话列表一样，只列头脑风暴会话（工作区下各子文件夹里的会话）。
 * 会话第一次发送后才入库，所以刚开的新头脑风暴先显示成一行「新的头脑风暴」。
 * 每行悬停出现删除：会话和工作文件夹一起删（先确认）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Plus, Sparkles, Trash2 } from "../../../../shared/ui/icons";
import { Modal } from "../../../../shared/ui/Modal";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { sessionDisplayTitle, type HarnessId } from "../../../sessions/model/session";
import { requestOpenSession } from "../../model/appActions";
import { deleteBrainstorm, listBrainstormSessions, startNewBrainstorm, useBrainstormRoot, type BrainstormSession } from "../../model/brainstorm";
import { useBrainstormActive } from "../../model/projectViews";

/** 「3 分钟前」这类相对时间，跟着界面语言。 */
function useRelativeTime() {
  const { i18n } = useTranslation("soloyard");
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  return (ms: number) => {
    const minutes = Math.round((ms - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    if (Math.abs(minutes) < 60 * 24) return rtf.format(Math.round(minutes / 60), "hour");
    return rtf.format(Math.round(minutes / 60 / 24), "day");
  };
}

/** 只在当前聚焦的是头脑风暴会话时显示；Sidebar 里只挂这一行。 */
export function BrainstormSidebar({ activeSessionId }: { activeSessionId?: string }) {
  return useBrainstormActive() ? <BrainstormList activeSessionId={activeSessionId} /> : null;
}

const folderOf = (cwd: string) => cwd.replace(/\/+$/, "").split("/").pop() ?? "";
/** 库里的标题带「claude · 」前缀，和底座会话列表一样去掉；还没起标题的算未命名。 */
const titleOf = (r: BrainstormSession) => {
  const title = r.title ? sessionDisplayTitle(r.title, r.harness as HarnessId) : "";
  return title === "New session" ? "" : title;
};

function BrainstormList({ activeSessionId }: { activeSessionId?: string }) {
  const { t } = useTranslation("soloyard");
  const root = useBrainstormRoot();
  const [rows, setRows] = useState<BrainstormSession[]>([]);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<BrainstormSession | null>(null);
  const [reload, setReload] = useState(0);
  const relative = useRelativeTime();

  // 底座写会话不发 soloyard:changed：切会话时重取，平时每 5 秒取一次（标题、更新时间会变）
  useEffect(() => {
    if (!root) return;
    let alive = true;
    const load = () =>
      listBrainstormSessions(root).then(
        (next) => alive && (setRows(next), setError("")),
        (e: unknown) => alive && setError(String(e)),
      );
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [root, activeSessionId, reload]);

  const draftActive = !!activeSessionId && !rows.some((r) => r.id === activeSessionId);

  return (
    // 面板本身是半透明玻璃，盖一层挡不住：显示列表时把面板里原来的内容隐藏（不卸载，退出头脑风暴就回来），列表直接用面板的玻璃背景
    <div data-soloyard-brainstorm="" className="absolute inset-0 z-[5] flex min-h-0 flex-col">
      <style>{`aside:has(> [data-soloyard-brainstorm]) > :not([data-soloyard-brainstorm]):not([role="separator"]) { visibility: hidden; }`}</style>
      <div className="flex h-10 shrink-0 select-none items-center gap-1.5 border-b border-stroke pl-3 pr-1.5" data-tauri-drag-region="deep">
        <Sparkles className="size-3.5 shrink-0 text-content/60" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">{t("view.brainstorm")}</span>
        <button
          type="button"
          aria-label={t("brainstorm.start")}
          title={t("brainstorm.start")}
          onClick={() => void startNewBrainstorm().catch((e: unknown) => setError(String(e)))}
          className="grid size-7 shrink-0 place-items-center rounded-md text-content/60 hover:bg-content/10 hover:text-content"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {error ? <p role="alert" className="px-3 py-2 text-[12px] text-red-400">{error}</p> : null}
        {!rows.length && !draftActive ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Sparkles className="size-5 text-content/30" />
            <p className="text-[12px] leading-relaxed text-content/50">{t("brainstorm.empty.body")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {draftActive ? (
              <li>
                <div aria-current="true" className="flex flex-col gap-0.5 rounded-md bg-selection px-2.5 py-2">
                  <span className="truncate text-[13px] text-content/60">{t("brainstorm.untitled")}</span>
                  <span className="text-[11px] text-content/40">{t("brainstorm.draft")}</span>
                </div>
              </li>
            ) : null}
            {rows.map((r) => (
              <li key={r.id} className="group relative">
                <button
                  type="button"
                  aria-current={r.id === activeSessionId}
                  onClick={() => requestOpenSession(r.id)}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 pr-8 text-left ${r.id === activeSessionId ? "bg-selection" : "hover:bg-content/5"}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <HarnessIcon harness={r.harness as "claude"} className="size-3 shrink-0" />
                    <span className="truncate text-[13px] text-content">{titleOf(r) || t("brainstorm.untitled")}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
                    <span className="truncate font-mono">{folderOf(r.cwd)}</span>
                    <span className="ml-auto shrink-0">{relative(r.updated_at)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("brainstorm.remove.action")}
                  title={t("brainstorm.remove.action")}
                  onClick={() => setRemoving(r)}
                  className="absolute right-1.5 top-2 hidden size-6 place-items-center rounded text-content/45 hover:bg-red-500/10 hover:text-red-400 focus-visible:grid group-hover:grid"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing ? (
        <RemoveDialog
          session={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function RemoveDialog({ session, onClose, onRemoved }: { session: BrainstormSession; onClose: () => void; onRemoved: () => void }) {
  const { t } = useTranslation("soloyard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = titleOf(session) || t("brainstorm.untitled");
  return (
    <Modal title={t("brainstorm.remove.title", { title })} size="sm" onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-4 p-4 text-[12px] text-content/80">
        <p className="leading-relaxed">{t("brainstorm.remove.body", { folder: folderOf(session.cwd) })}</p>
        {error ? <p role="alert" className="text-[11px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-content/70 hover:bg-content/8 disabled:opacity-40">{t("iterations.cancel")}</button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await deleteBrainstorm(session.id, session.cwd);
                onRemoved();
              } catch (e) {
                setError(String(e));
                setBusy(false);
              }
            }}
            className="rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30 disabled:opacity-40"
          >
            {t("iterations.remove.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
