/**
 * 头脑风暴「提升为项目」：名称、位置由用户定（不由 AI 选）；列出工作文件夹里现有的产物，说明会依次做什么，
 * 确认后按步骤执行（model/brainstorm.ts 的 promoteBrainstorm），每步显示进度，出错停在弹窗里说明原因。
 * 完成后会话已经在项目文件夹里，侧栏切到新项目。
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "../../../../i18n";
import { listDir, pickFolders } from "../../../../platform/tauri/fs";
import { Check, File, FolderOpen, Loader } from "../../../../shared/ui/icons";
import { Modal } from "../../../../shared/ui/Modal";
import { FOLDER_NAME, promoteBrainstorm, type PromoteStep } from "../../model/brainstorm";

const field = "rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25";
const labelText = "text-[12px] font-medium text-content/70";
const primaryButton = "inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40";
const STEPS: PromoteStep[] = ["folder", "session", "project", "files", "cleanup"];

export function BrainstormPromoteDialog({ sessionId, folder, title, onClose }: { sessionId: string; folder: string; title: string; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const [name, setName] = useState(title);
  const [parent, setParent] = useState("");
  const [dirName, setDirName] = useState(FOLDER_NAME.test(title) ? title : "");
  const [files, setFiles] = useState<string[] | null>(null);
  /** null = 还没开始；否则是正在做 / 停在的那一步。 */
  const [step, setStep] = useState<PromoteStep | null>(null);
  const [error, setError] = useState("");
  const running = step !== null && !error;
  // 前两步失败时什么都没留下（挪会话失败会删掉刚建的空文件夹），可以改了再试；之后的步骤失败要用户先看清楚
  const canRetry = !!error && (step === "folder" || step === "session");
  const locked = running || (!!error && !canRetry);

  useEffect(() => {
    listDir(folder).then(
      (entries) => setFiles(entries.filter((e) => !e.name.startsWith(".")).map((e) => e.name)),
      () => setFiles([]),
    );
  }, [folder]);

  const dirValid = FOLDER_NAME.test(dirName);
  const path = parent && dirName ? `${parent.replace(/\/+$/, "")}/${dirName}` : "";
  const ready = !!name.trim() && !!parent && dirValid;
  const stepLabel = (s: PromoteStep) =>
    s === "folder" ? t("brainstorm.promoteDialog.stepFolder", { path: path || "…" })
    : s === "project" ? t("brainstorm.promoteDialog.stepProject", { name: name.trim() || "…" })
    : s === "files" ? t("brainstorm.promoteDialog.stepFiles", { count: files?.length ?? 0 })
    : s === "session" ? t("brainstorm.promoteDialog.stepSession")
    : t("brainstorm.promoteDialog.stepCleanup");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || running) return;
    setError("");
    try {
      await promoteBrainstorm({ sessionId, folder, name: name.trim(), parent, dirName }, setStep);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal title={t("brainstorm.promoteDialog.title")} size="md" onClose={() => !running && onClose()}>
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <fieldset disabled={locked} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>{t("brainstorm.promoteDialog.name")}</span>
            <input autoFocus value={name} maxLength={60} placeholder={t("brainstorm.promoteDialog.namePlaceholder")} onChange={(e) => setName(e.target.value)} className={`h-9 ${field}`} />
          </label>
          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={labelText}>{t("brainstorm.promoteDialog.location")}</span>
              <button
                type="button"
                onClick={async () => {
                  const [picked] = await pickFolders(t("brainstorm.promoteDialog.location"));
                  if (picked) setParent(picked);
                }}
                className={`flex h-9 items-center gap-2 text-left ${field} ${parent ? "" : "text-content/40"}`}
              >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{parent || t("brainstorm.promoteDialog.pick")}</span>
              </button>
            </div>
            <label className="flex w-48 flex-col gap-1.5">
              <span className={labelText}>{t("brainstorm.promoteDialog.folder")}</span>
              <input value={dirName} spellCheck={false} placeholder="xhs-assistant" onChange={(e) => setDirName(e.target.value)} className={`h-9 font-mono ${field} ${dirName && !dirValid ? "border-red-400/50" : ""}`} />
            </label>
          </div>
          {dirName && !dirValid ? <p role="alert" className="-mt-2 text-[11px] text-red-400/90">{t("brainstorm.promoteDialog.folderInvalid")}</p> : null}
          <div className="flex flex-col gap-1.5">
            <span className={labelText}>{t("brainstorm.promoteDialog.files")}</span>
            {files === null ? null : files.length ? (
              <ul className="max-h-36 overflow-y-auto rounded-md border border-content/10">
                {files.map((f) => (
                  <li key={f} className="flex h-8 items-center gap-2 border-b border-content/5 px-2.5 text-[12px] last:border-b-0">
                    <File className="size-3.5 shrink-0 text-content/40" />
                    <span className="truncate text-content/80">{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-content/45">{t("brainstorm.promoteDialog.noFiles")}</p>
            )}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5 rounded-lg bg-content/5 px-3 py-2.5 text-[12px]">
          <span className="text-content/60">{t("brainstorm.promoteDialog.willDo")}</span>
          <ol className="flex flex-col gap-1 text-content/80">
            {STEPS.map((s, i) => {
              const at = step ? STEPS.indexOf(step) : -1;
              const state = at > i ? "done" : at === i ? (error ? "failed" : "running") : "todo";
              return (
                <li key={s} className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
                    {state === "done" ? <Check className="size-3.5 text-accent" /> : state === "running" ? <Loader className="size-3.5 animate-spin" /> : <span className={`text-[11px] ${state === "failed" ? "text-red-400" : "text-content/40"}`}>{i + 1}</span>}
                  </span>
                  <span className={state === "failed" ? "text-red-400" : state === "todo" ? "" : "text-content"}>{stepLabel(s)}</span>
                </li>
              );
            })}
          </ol>
        </div>
        {error ? <p role="alert" className="text-[12px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={running} onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40">
            {t("iterations.cancel")}
          </button>
          {error && !canRetry ? null : (
            <button type="submit" disabled={!ready || running} className={primaryButton}>
              {running ? <Loader className="size-3.5 animate-spin" /> : null}
              {t("brainstorm.promote")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
