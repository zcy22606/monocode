/**
 * 头脑风暴会话输入框顶栏的「工作区文件夹」：替代项目 / 当前检出 / 分支。
 * 发第一条消息前可以改名（改文件夹，再把会话工作目录指过去）；之后锁定，项目文件夹等提升为项目时再定。
 */
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "../../../../i18n";
import { ArrowUp, Folder, Sparkles } from "../../../../shared/ui/icons";
import { Popover } from "../../../../shared/ui/Popover";
import { FOLDER_NAME, renameBrainstormFolder } from "../../model/brainstorm";
import { BrainstormPromoteDialog } from "./BrainstormPromoteDialog";
import { sessionDisplayTitle, type HarnessId } from "../../../sessions/model/session";

/** locked = 会话已经发过消息：文件夹名锁定，出现「提升为项目」。 */
export function BrainstormFolderChip({ sessionId, cwd, title, harness, locked }: { sessionId: string; cwd: string; title?: string; harness: HarnessId; locked: boolean }) {
  const { t } = useTranslation("soloyard");
  const trigger = useRef<HTMLButtonElement>(null);
  const current = cwd.replace(/\/+$/, "").split("/").pop() ?? "";
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // 库里的标题带「claude · 」前缀；预填项目名时去掉，还没起标题就留空
  const shown = title ? sessionDisplayTitle(title, harness) : "";
  const displayTitle = shown === "New session" ? "" : shown;
  const trimmed = name.trim();
  const invalid = !trimmed ? t("brainstorm.folderChip.required") : !FOLDER_NAME.test(trimmed) ? t("brainstorm.promoteDialog.folderInvalid") : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid || busy) return;
    if (trimmed === current) return setOpen(false);
    setBusy(true);
    setError("");
    try {
      await renameBrainstormFolder(sessionId, cwd, trimmed);
      setOpen(false);
    } catch (cause) {
      const text = String(cause);
      setError(/exist/i.test(text) ? t("brainstorm.folderChip.exists", { name: trimmed }) : text.includes("busy") ? t("brainstorm.promoteDialog.busy") : text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="flex shrink-0 items-center gap-1 text-[12px] text-content/50">
        <Sparkles className="size-3.5" />
        {t("view.brainstorm")}
      </span>
      <button
        ref={trigger}
        type="button"
        disabled={locked}
        title={locked ? t("brainstorm.folderChip.locked", { path: cwd }) : t("brainstorm.folderChip.tooltip", { path: cwd })}
        onClick={() => {
          setName(current);
          setError("");
          setOpen(!open);
        }}
        className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[12px] ${locked ? "text-content/60" : "text-content/80 hover:bg-content/10 hover:text-content"} ${open ? "bg-content/10" : ""}`}
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{current}</span>
      </button>
      {locked ? (
        <button
          type="button"
          onClick={() => setPromoting(true)}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10"
        >
          <ArrowUp className="size-3.5" />
          {t("brainstorm.promote")}
        </button>
      ) : null}
      {promoting ? <BrainstormPromoteDialog sessionId={sessionId} folder={cwd} title={displayTitle} onClose={() => setPromoting(false)} /> : null}
      {open ? (
        <Popover anchor={trigger} side="top" align="start" gap={6} width={320} onDismiss={() => setOpen(false)} role="dialog" aria-label={t("brainstorm.folderChip.title")}>
          <form onSubmit={submit} className="flex flex-col gap-2 p-3 text-[12px]">
            <span className="font-medium text-content/80">{t("brainstorm.folderChip.title")}</span>
            <input
              autoFocus
              value={name}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              className={`h-8 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] text-content outline-none focus:border-content/25 ${invalid ? "border-red-400/50" : ""}`}
            />
            {invalid || error ? <span role="alert" className="text-[11px] text-red-400/90">{invalid || error}</span> : null}
            <span className="text-[11px] leading-relaxed text-content/45">{t("brainstorm.folderChip.hint")}</span>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2.5 py-1 text-content/70 hover:bg-content/8">{t("iterations.cancel")}</button>
              <button type="submit" disabled={!!invalid || busy} className="rounded-md bg-content px-2.5 py-1 font-medium text-background-base hover:bg-content/80 disabled:opacity-40">
                {t("iterations.form.save")}
              </button>
            </div>
          </form>
        </Popover>
      ) : null}
    </>
  );
}
