import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Modal } from "../../../../shared/ui/Modal";
import { soloyardCall } from "../../data/api";
import { DOC_TYPES } from "../../model/docs";
import { useProjectRepos } from "../../model/repos";

const field = "h-8 rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] text-content outline-none focus:border-content/25";

/** 新建文档：选类型、放在哪（根目录或某个成员仓库）、标题；编号和文件头由数据层按规范给（和 agent 的 MCP new_doc 同一套）。 */
export function NewDocDialog({ cwd, onClose, onCreated }: { cwd: string; onClose: () => void; onCreated: (path: string, title: string) => void }) {
  const { t } = useTranslation("soloyard");
  const repos = useProjectRepos(cwd)?.repos ?? [];
  const [draft, setDraft] = useState({ type: "product", repo: "", title: "", related: "" });
  const [error, setError] = useState("");
  const create = async () => {
    setError("");
    try {
      const made = await soloyardCall<{ path: string }>("newDoc", cwd, { ...draft, repo: draft.repo || null });
      onClose();
      onCreated(made.path, draft.title.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const row = "grid grid-cols-[72px_1fr] items-center gap-3";
  const label = "text-[12px] text-content/55";
  return (
    <Modal title={t("docs.newDialog.title")} size="md" onClose={onClose}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.title.trim()) void create();
        }}
      >
        <label className={row}>
          <span className={label}>{t("docs.newDialog.type")}</span>
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={field}>
            {DOC_TYPES.filter((k) => k !== "archive").map((k) => (
              <option key={k} value={k}>
                {t(`docs.type.${k}`)} · {t(`docs.typeHint.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {repos.length ? (
          <label className={row}>
            <span className={label}>{t("docs.newDialog.where")}</span>
            <select value={draft.repo} onChange={(e) => setDraft({ ...draft, repo: e.target.value })} className={field}>
              <option value="">{t("docs.newDialog.whereRoot")}</option>
              {repos.map((r) => (
                <option key={r.path} value={r.path}>
                  {t("docs.newDialog.whereRepo", { name: r.name })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={row}>
          <span className={label}>{t("docs.newDialog.titleLabel")}</span>
          <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("docs.newDialog.titlePlaceholder")} className={field} />
        </label>
        <label className={row}>
          <span className={label}>{t("docs.newDialog.related")}</span>
          <input value={draft.related} onChange={(e) => setDraft({ ...draft, related: e.target.value })} placeholder={t("docs.newDialog.relatedPlaceholder")} className={field} />
        </label>
        <p className="text-[11.5px] text-content/45">{t("docs.newDialog.note", { dir: `docs/${draft.type}/` })}</p>
        {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-stroke pt-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1 text-[12.5px] text-content/60 hover:bg-content/10">
            {t("docs.newDialog.cancel")}
          </button>
          <button type="submit" disabled={!draft.title.trim()} className="rounded-md bg-accent/90 px-3 py-1 text-[12.5px] font-medium text-white hover:bg-accent disabled:opacity-40">
            {t("docs.newDialog.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
