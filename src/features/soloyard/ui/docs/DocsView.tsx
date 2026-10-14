import { useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { basename } from "../../../../platform/tauri/fs";
import { soloyardCall } from "../../data/api";
import { requestStartWork } from "../../model/appActions";
import { docCode, docsSignature, filterDocs, groupDocs, isRetired, usePoll, type DocEntry, type DocGroupMode, type DocState } from "../../model/docs";
import { openProjectView, viewLabel } from "../../model/projectViews";
import { NewDocDialog } from "./NewDocDialog";

export const docTime = (ms: number | null, lang: string) =>
  ms == null ? "" : new Date(ms).toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const MODE_KEY = "soloyard.docs.group";
const STATE_STYLE: Record<DocState, string> = {
  confirmed: "bg-emerald-400/10 text-emerald-300",
  active: "bg-sky-400/10 text-sky-300",
  draft: "bg-content/10 text-content/65",
  done: "bg-content/5 text-content/50",
  partial: "bg-orange-400/10 text-orange-300",
  superseded: "bg-red-400/10 text-red-300",
  archived: "bg-content/5 text-content/40",
};

/**
 * Docs 页（文档规范 docs/soloyard/docs-convention.md）：项目根目录和成员仓库 docs/ 里的文档汇总在一起，
 * 按类型 / 按仓库 / 时间线看；编号、仓库、状态、日期取自目录和文件头。已废弃 / 已归档默认藏起来；不在类型目录里的进「未归类」，
 * 「整理文档」开会话让 agent 按规范归位。agent 改了文件几秒内刷新。
 */
export function DocsView({ cwd }: { cwd: string }) {
  const { t, i18n } = useTranslation("soloyard");
  const [docs, setDocs] = useState<DocEntry[] | null>();
  const signature = useRef<string | undefined>(undefined);
  usePoll(() => {
    soloyardCall<DocEntry[]>("listDocs", cwd).then(
      (next) => {
        const sig = docsSignature(next);
        if (sig === signature.current) return;
        signature.current = sig;
        setDocs(next);
      },
      () => setDocs(null),
    );
  });
  const [mode, setModeState] = useState<DocGroupMode>(() => (localStorage.getItem(MODE_KEY) as DocGroupMode | null) ?? "type");
  const setMode = (m: DocGroupMode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  };
  const [repos, setRepos] = useState(new Set<string>());
  const [showRetired, setShowRetired] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const all = docs ?? [];
  const overview = all.find((d) => d.auto);
  const repoList = useMemo(() => [...new Map(all.map((d) => [d.repo ?? "", d.repoName])).entries()], [all]);
  const multiRepo = repoList.length > 1;
  const retired = all.filter((d) => isRetired(d)).length;
  const unsorted = all.filter((d) => !d.type && !d.auto).length;
  const groups = groupDocs(filterDocs(all, { repos, showRetired, q }), mode);

  const open = (doc: DocEntry) => openProjectView({ cwd, view: "doc", itemId: doc.path, title: doc.title });
  // 规范全文跟着提示词走：会话不一定连着带规范的 MCP
  const organize = () =>
    void soloyardCall<string>("docConvention").then((convention) =>
      requestStartWork({ cwd, sessionId: crypto.randomUUID(), prompt: t("docs.organizePrompt", { convention }) }),
    );
  const toggleRepo = (key: string) => {
    const next = new Set(repos);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRepos(next);
  };
  const groupLabel = (key: string) =>
    mode === "type"
      ? t(`docs.type.${key as "product"}`)
      : mode === "repo"
        ? key
          ? basename(key)
          : t("docs.root")
        : new Date(`${key}-01T00:00:00`).toLocaleDateString(i18n.language, { year: "numeric", month: "long" });

  const chip = "rounded-full border px-2.5 py-0.5 text-[11.5px]";
  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-content/40">{basename(cwd)} · docs/</div>
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-medium text-content">{viewLabel("docs")}</h1>
            <span className="ml-auto flex gap-1.5">
              <button type="button" onClick={() => setCreating(true)} className="rounded-md border border-accent/50 px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent/10">
                {t("docs.new")}
              </button>
              <button type="button" onClick={organize} title={t("docs.organizeHint")} className="flex items-center gap-1.5 rounded-md border border-stroke px-2.5 py-1 text-[12px] text-content/75 hover:bg-content/10 hover:text-content">
                {t("docs.organize")}
                {unsorted ? <span className="rounded-full bg-amber-400/15 px-1.5 text-[10.5px] text-amber-300">{unsorted}</span> : null}
              </button>
            </span>
          </div>
          <p className="text-[12px] text-content/45">{multiRepo ? t("docs.scope", { count: repoList.length - 1 }) : t("docs.scopeRoot")}</p>
        </header>

        {docs === undefined ? null : !all.length ? (
          <p className="text-[13px] leading-relaxed text-content/50">{t("docs.noFolder")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex overflow-hidden rounded-md border border-stroke">
                {(["type", "repo", "time"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`px-2.5 py-1 text-[12px] ${mode === m ? "bg-selection text-content" : "text-content/55 hover:text-content"}`}>
                    {t(`docs.group.${m}`)}
                  </button>
                ))}
              </span>
              {multiRepo
                ? repoList.map(([key, name]) => (
                    <button key={key} type="button" onClick={() => toggleRepo(key)} className={`${chip} ${repos.has(key) ? "border-accent/45 bg-accent/10 text-accent" : "border-stroke text-content/55 hover:text-content"}`}>
                      {name ?? t("docs.root")}
                    </button>
                  ))
                : null}
              {retired ? (
                <button type="button" onClick={() => setShowRetired(!showRetired)} className={`${chip} ${showRetired ? "border-accent/45 bg-accent/10 text-accent" : "border-stroke text-content/55 hover:text-content"}`}>
                  {t("docs.showRetired", { count: retired })}
                </button>
              ) : null}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("docs.search")} className="ml-auto h-7 w-44 rounded-md border border-stroke bg-content/5 px-2.5 text-[12px] text-content outline-none focus:border-content/25" />
            </div>

            {overview && !q ? (
              <button type="button" onClick={() => openProjectView({ cwd, view: "overview", title: viewLabel("overview") })} className="flex h-9 items-center gap-2 rounded-md border border-stroke px-3 text-left text-[13px] text-content/80 hover:bg-content/5">
                {t("docs.overviewRow")}
                <span className="rounded bg-content/10 px-1.5 text-[11px] text-content/55" title={t("docs.autoHint")}>{t("docs.auto")}</span>
              </button>
            ) : null}

            {groups.map((g) => (
              <section key={g.key} className="flex flex-col">
                <h2 className="flex items-baseline gap-2 pb-1.5 text-[13px] font-medium text-content">
                  {groupLabel(g.key)}
                  <span className="text-[11.5px] font-normal text-content/40">
                    {g.docs.length}
                    {mode === "type" ? ` · ${t(`docs.typeHint.${g.key as "product"}`)}` : ""}
                  </span>
                </h2>
                <ul className="border-t border-stroke">
                  {g.docs.map((d) => (
                    <li key={d.path}>
                      <DocRow doc={d} showRepo={multiRepo && mode !== "repo"} showType={mode !== "type"} onOpen={() => open(d)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
      {creating ? <NewDocDialog cwd={cwd} onClose={() => setCreating(false)} onCreated={(path, title) => openProjectView({ cwd, view: "doc", itemId: path, title })} /> : null}
    </div>
  );
}

function DocRow({ doc, showRepo, showType, onOpen }: { doc: DocEntry; showRepo: boolean; showType: boolean; onOpen: () => void }) {
  const { t } = useTranslation("soloyard");
  const code = docCode(doc);
  return (
    <button type="button" onClick={onOpen} className="grid w-full grid-cols-[136px_1fr_auto_76px] items-center gap-3 border-b border-stroke px-1 py-2 text-left hover:bg-content/5">
      <span className="truncate font-mono text-[11.5px] text-content/45">{code ?? ""}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] text-content/90">{doc.title}</span>
        {showType && doc.type ? <span className="shrink-0 text-[11px] text-content/40">{t(`docs.type.${doc.type}`)}</span> : null}
        {!doc.type ? <span className="min-w-0 truncate font-mono text-[11px] text-content/35">{doc.rel}</span> : null}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {showRepo ? <span className="whitespace-nowrap rounded bg-content/5 px-1.5 text-[11px] text-content/55">{doc.repoName ?? t("docs.root")}</span> : null}
        <span title={doc.status ?? undefined} className={`whitespace-nowrap rounded px-1.5 text-[11px] ${doc.state ? STATE_STYLE[doc.state] : "border border-dashed border-content/15 text-content/35"}`}>
          {t(`docs.state.${doc.state ?? "none"}`)}
        </span>
      </span>
      <span title={doc.dateFrom === "file" ? t("docs.dateFromFile") : undefined} className={`text-right text-[12px] ${doc.dateFrom === "file" ? "text-content/30" : "text-content/50"}`}>
        {doc.date}
      </span>
    </button>
  );
}
