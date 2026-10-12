/**
 * 头脑风暴时的侧栏：盖在工作区面板上，样子和会话列表一样，只列头脑风暴会话（工作区下各子文件夹里的会话）。
 * 每个头脑风暴是一条想法项目（agent 维护标题、英文名、一句话），所以每行显示想法项目的标题和一句话；还没起名的用会话标题。
 * 会话第一次发送后才入库，所以刚开的新头脑风暴先显示成一行「新的头脑风暴」。
 * 每行悬停出现改名（双击 / F2 也行，改的是想法项目的标题）、归档（搁置 / 放弃，放弃要写原因）和删除（会话、工作文件夹、
 * 想法项目一起删，先确认）。归档的折叠在列表底部，可以恢复。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Archive, ChevronDown, ChevronRight, Pencil, Plus, Sparkles, Trash2, Undo2 } from "../../../../shared/ui/icons";
import { Modal } from "../../../../shared/ui/Modal";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { sessionDisplayTitle, type HarnessId } from "../../../sessions/model/session";
import { mutateSoloyard } from "../../data/api";
import { requestOpenSession, requestRenameSession } from "../../model/appActions";
import { deleteBrainstorm, isArchived, listBrainstormSessions, listIdeas, startNewBrainstorm, useBrainstormRoot, type BrainstormSession, type Idea } from "../../model/brainstorm";
import { useBrainstormActive } from "../../model/projectViews";
import { isComposing } from "../keys";

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
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [archiving, setArchiving] = useState<Idea | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<BrainstormSession | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const relative = useRelativeTime();

  // 底座写会话不发 soloyard:changed：切会话时重取，平时每 5 秒取一次（标题、更新时间会变）
  useEffect(() => {
    if (!root) return;
    let alive = true;
    const load = () =>
      Promise.all([listBrainstormSessions(root), listIdeas(root)]).then(
        ([next, nextIdeas]) => alive && (setRows(next), setIdeas(nextIdeas), setError("")),
        (e: unknown) => alive && setError(String(e)),
      );
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [root, activeSessionId, reload]);

  const clean = (p: string) => p.replace(/\/+$/, "");
  const ideaOf = (r: BrainstormSession) => ideas.find((i) => clean(i.path) === clean(r.cwd));
  const nameOf = (r: BrainstormSession) => ideaOf(r)?.name || titleOf(r);

  const rename = (r: BrainstormSession, title: string) => {
    setRenaming(null);
    const trimmed = title.trim();
    if (!trimmed || trimmed === nameOf(r)) return;
    const idea = ideaOf(r);
    // 标题是想法项目的（agent 也在维护）；还没有想法项目的老会话退回改会话标题
    if (idea) {
      void mutateSoloyard("updateOverview", idea.id, [{ key: "name", body: trimmed }]).catch((e: unknown) => setError(String(e)));
      setIdeas((prev) => prev.map((x) => (x.id === idea.id ? { ...x, name: trimmed } : x)));
      return;
    }
    requestRenameSession(r.id, trimmed);
    // 库里存的是带「harness · 」前缀的标题，列表显示时会去掉；先在本地改掉，等下次轮询拿到库里的
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, title: trimmed } : x)));
  };
  const restore = (idea: Idea) =>
    void mutateSoloyard("setProjectStage", idea.id, "resume").then(() => setReload((n) => n + 1), (e: unknown) => setError(String(e)));

  const draftActive = !!activeSessionId && !rows.some((r) => r.id === activeSessionId);
  const active = rows.filter((r) => !isArchived(ideaOf(r)));
  const archived = rows.filter((r) => isArchived(ideaOf(r)));

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
            {active.map((r) => (
              <li key={r.id} className="group relative">
                {renaming === r.id ? (
                  <div className={`rounded-md px-2.5 py-2 ${r.id === activeSessionId ? "bg-selection" : ""}`}>
                    <input
                      autoFocus
                      defaultValue={nameOf(r)}
                      aria-label={t("brainstorm.rename")}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => rename(r, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (isComposing(e)) return;
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded bg-content/10 px-2 py-1 text-[13px] text-content outline-none ring-1 ring-accent/40"
                    />
                  </div>
                ) : (
                <>
                <button
                  type="button"
                  aria-current={r.id === activeSessionId}
                  onClick={() => requestOpenSession(r.id)}
                  onDoubleClick={() => setRenaming(r.id)}
                  onKeyDown={(e) => e.key === "F2" && setRenaming(r.id)}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 pr-20 text-left ${r.id === activeSessionId ? "bg-selection" : "hover:bg-content/5"}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <HarnessIcon harness={r.harness as "claude"} className="size-3 shrink-0" />
                    <span className="truncate text-[13px] text-content">{nameOf(r) || t("brainstorm.untitled")}</span>
                  </span>
                  {ideaOf(r)?.goal ? <span className="line-clamp-2 text-[11.5px] leading-snug text-content/55">{ideaOf(r)!.goal}</span> : null}
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
                    <span className="truncate font-mono">{ideaOf(r)?.slug || folderOf(r.cwd)}</span>
                    <span className="ml-auto shrink-0">{relative(r.updated_at)}</span>
                  </span>
                </button>
                <div className="absolute right-1.5 top-2 hidden items-center gap-0.5 focus-within:flex group-hover:flex">
                  {ideaOf(r) ? (
                    <button
                      type="button"
                      aria-label={t("brainstorm.archive.action")}
                      title={t("brainstorm.archive.action")}
                      onClick={() => setArchiving(ideaOf(r)!)}
                      className="grid size-6 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
                    >
                      <Archive className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t("brainstorm.rename")}
                    title={t("brainstorm.rename")}
                    onClick={() => setRenaming(r.id)}
                    className="grid size-6 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("brainstorm.remove.action")}
                    title={t("brainstorm.remove.action")}
                    onClick={() => setRemoving(r)}
                    className="grid size-6 place-items-center rounded text-content/45 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                </>
                )}
              </li>
            ))}
          </ul>
        )}
        {archived.length ? (
          <div className="border-t border-stroke p-1.5">
            <button type="button" onClick={() => setShowArchived((v) => !v)} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-content/45 hover:bg-content/5 hover:text-content/70">
              {showArchived ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {t("brainstorm.archive.section", { count: archived.length })}
            </button>
            {showArchived ? (
              <ul className="flex flex-col gap-0.5">
                {archived.map((r) => {
                  const idea = ideaOf(r)!;
                  return (
                    <li key={r.id} className="group relative">
                      <button type="button" onClick={() => requestOpenSession(r.id)} className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 pr-10 text-left ${r.id === activeSessionId ? "bg-selection" : "hover:bg-content/5"}`}>
                        <span className="truncate text-[12.5px] text-content/60">{nameOf(r) || t("brainstorm.untitled")}</span>
                        <span className="truncate text-[11px] text-content/40">
                          {t(`brainstorm.archive.${idea.stage === "killed" ? "killed" : "parked"}`)}
                          {idea.note?.reason ? ` · ${idea.note.reason}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={t("brainstorm.archive.restore")}
                        title={t("brainstorm.archive.restore")}
                        onClick={() => restore(idea)}
                        className="absolute right-1.5 top-1.5 hidden size-6 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content group-hover:grid"
                      >
                        <Undo2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {archiving ? (
        <ArchiveDialog
          idea={archiving}
          title={archiving.name || t("brainstorm.untitled")}
          onClose={() => setArchiving(null)}
          onDone={() => {
            setArchiving(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
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

/** 归档：搁置（以后可能再捡起来）或放弃（要写原因），都能恢复。 */
function ArchiveDialog({ idea, title, onClose, onDone }: { idea: Idea; title: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation("soloyard");
  const [kind, setKind] = useState<"parked" | "killed">("parked");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = kind === "parked" || !!reason.trim();
  return (
    <Modal title={t("brainstorm.archive.title", { title })} size="sm" onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-3 p-4 text-[12px] text-content/80">
        {(["parked", "killed"] as const).map((k) => (
          <label key={k} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="archive-kind" checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-content">{t(`brainstorm.archive.${k}`)}</span>
              <span className="text-content/50">{t(`brainstorm.archive.${k}Hint`)}</span>
            </span>
          </label>
        ))}
        <textarea
          value={reason}
          rows={2}
          placeholder={t(kind === "killed" ? "brainstorm.archive.reasonRequired" : "brainstorm.archive.reasonOptional")}
          onChange={(e) => setReason(e.target.value)}
          className="resize-none rounded-md border border-content/10 bg-content/5 px-2.5 py-2 text-[12px] text-content outline-none focus:border-content/25"
        />
        {error ? <p role="alert" className="text-[11px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-content/70 hover:bg-content/8 disabled:opacity-40">{t("iterations.cancel")}</button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await mutateSoloyard("setProjectStage", idea.id, kind, reason.trim() || undefined);
                onDone();
              } catch (e) {
                setError(String(e));
                setBusy(false);
              }
            }}
            className="rounded-md bg-content px-3 py-1.5 font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            {t("brainstorm.archive.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
