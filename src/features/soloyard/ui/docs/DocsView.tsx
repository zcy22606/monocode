import { useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { basename } from "../../../../platform/tauri/fs";
import { File, Folder } from "../../../../shared/ui/icons";
import { docsSignature, isOverviewDoc, scanDocs, usePoll, type DocEntry } from "../../model/docs";
import { openProjectView, viewLabel } from "../../model/projectViews";

export const docTime = (ms: number | null, lang: string) =>
  ms == null ? "" : new Date(ms).toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Docs 页：项目根目录 docs/ 下的 .md / .json，按目录分组，带最后修改时间。agent 改了文件几秒内刷新。 */
export function DocsView({ cwd }: { cwd: string }) {
  const { t, i18n } = useTranslation("soloyard");
  const [docs, setDocs] = useState<DocEntry[] | null>();
  const signature = useRef<string | undefined>(undefined);
  usePoll(() => {
    void scanDocs(cwd).then((next) => {
      const sig = docsSignature(next);
      if (sig === signature.current) return;
      signature.current = sig;
      setDocs(next);
    });
  });

  const open = (doc: DocEntry) =>
    isOverviewDoc(doc.rel)
      ? openProjectView({ cwd, view: "overview", title: viewLabel("overview") })
      : openProjectView({ cwd, view: "doc", itemId: doc.rel, title: doc.name });
  const groups = new Map<string, DocEntry[]>();
  for (const doc of docs ?? []) groups.set(doc.dir, [...(groups.get(doc.dir) ?? []), doc]);

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-content/40">{basename(cwd)} · docs/</div>
          <h1 className="text-[18px] font-medium text-content">{viewLabel("docs")}</h1>
        </header>
        {docs === undefined ? null : !docs?.length ? (
          <p className="text-[13px] leading-relaxed text-content/50">{t(docs ? "docs.emptyFolder" : "docs.noFolder")}</p>
        ) : (
          <ul className="flex flex-col border-t border-stroke">
            {[...groups].map(([dir, items]) => (
              <li key={dir}>
                {dir ? (
                  <div className="flex h-8 items-center gap-2 border-b border-stroke px-1 text-[12px] text-content/50">
                    <Folder className="size-3.5" />
                    {dir}/
                  </div>
                ) : null}
                <ul>
                  {items.map((doc) => (
                    <li key={doc.rel}>
                      <button
                        type="button"
                        onClick={() => open(doc)}
                        className={`flex h-9 w-full items-center gap-2 border-b border-stroke text-left text-[13px] text-content/85 hover:bg-content/5 ${dir ? "pl-6 pr-1" : "px-1"}`}
                      >
                        <File className="size-3.5 shrink-0 text-content/40" />
                        <span className="min-w-0 truncate">{doc.name}</span>
                        {isOverviewDoc(doc.rel) ? (
                          <span className="shrink-0 rounded bg-content/10 px-1.5 text-[11px] text-content/55" title={t("docs.autoHint")}>
                            {t("docs.auto")}
                          </span>
                        ) : null}
                        <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-content/40">{docTime(doc.mtimeMs, i18n.language)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
