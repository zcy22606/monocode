import { useTranslation } from "../../../i18n";
import { X } from "../../../shared/ui/icons";

/** 顶部提示条：整批操作后给「撤销」，或显示失败原因。 */
export type Notice = { kind: "undo"; batch: string; message: string } | { kind: "error"; message: string };

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function NoticeBar({ notice, onUndo, onClose }: { notice: Notice; onUndo: (batch: string) => void; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  return (
    <div className={`flex shrink-0 items-center gap-2 border-b border-stroke px-4 py-1.5 text-[12px] ${notice.kind === "error" ? "bg-red-500/10 text-red-300" : "bg-content/5 text-content/70"}`}>
      <span role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "min-w-0 whitespace-pre-line" : "min-w-0 truncate"} title={notice.message}>{notice.message}</span>
      {notice.kind === "undo" ? (
        <button type="button" onClick={() => onUndo(notice.batch)} className="ml-auto shrink-0 whitespace-nowrap rounded px-2 py-0.5 font-medium text-content hover:bg-content/10">
          {t("iterations.undo")}
        </button>
      ) : null}
      <button type="button" aria-label={t("iterations.close")} onClick={onClose} className={`shrink-0 rounded p-0.5 opacity-60 hover:bg-content/10 hover:opacity-100 ${notice.kind === "undo" ? "" : "ml-auto"}`}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
