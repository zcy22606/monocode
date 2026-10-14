import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { basename, readTextFile, statFiles, writeTextFile } from "../../../../platform/tauri/fs";
import { AgentMarkdown } from "../../../sessions/ui/AgentMarkdown";
import { asPtDoc, decisionIndex, docKind, docPath, docsRoot, linkRefsInMarkdown, REF_HREF, usePoll, type DecisionInfo, type RefKind } from "../../model/docs";
import { openProjectView, viewLabel } from "../../model/projectViews";
import { isComposing } from "../keys";
import { PtDocView, RawJson } from "./DocBlocks";
import { docTime } from "./DocsView";

type Loaded = { text: string; mtimeMs: number | null };

/**
 * 一篇文档：.md 渲染（可编辑，存回文件），.json 只读（SCHEMA 的节 + 块用块渲染器，其余原样折叠）。文件被外面改了自动重读。
 * rel 是文件的绝对路径（根目录或成员仓库的 docs/ 里）；之前存下的相对根目录 docs/ 的路径照样能开。
 */
export function DocDetail({ cwd, rel }: { cwd: string; rel: string }) {
  const { t, i18n } = useTranslation("soloyard");
  const path = docPath(cwd, rel);
  const kind = docKind(path);
  const isOverview = path === `${docsRoot(cwd)}/overview.md`;
  /** 标题栏显示相对项目根目录的路径。 */
  const shown = path.startsWith(`${cwd.replace(/\/+$/, "")}/`) ? path.slice(cwd.replace(/\/+$/, "").length + 1) : path;
  const [file, setFile] = useState<Loaded | null>(); // null = 文件没了
  const [draft, setDraft] = useState<string | null>(null);
  /** 开始编辑时文件的 mtime：保存时对不上 = agent 在这期间改过，不直接覆盖。 */
  const [editBase, setEditBase] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState(new Map<string, DecisionInfo>());
  const mtime = useRef<number | null | undefined>(undefined);

  const reload = useCallback(async () => {
    const [stat] = await statFiles([path]).catch(() => [{ path, mtimeMs: null }]);
    if (stat.mtimeMs === mtime.current) return;
    mtime.current = stat.mtimeMs;
    if (stat.mtimeMs == null) return setFile(null);
    try {
      setFile({ text: await readTextFile(path), mtimeMs: stat.mtimeMs });
    } catch (e) {
      setError(String(e));
    }
  }, [path]);
  usePoll(() => void reload());

  // decision_ref 卡片的标题：product-thinking 的 decisions.json（项目根目录），读不到就只显示编号
  useEffect(() => {
    if (kind !== "json") return;
    readTextFile(`${cwd.replace(/\/+$/, "")}/decisions.json`)
      .then((text) => setDecisions(decisionIndex(JSON.parse(text))))
      .catch(() => undefined);
  }, [cwd, kind]);

  // ponytail: E-x 先不跳，D-x 打开 Decisions；SOL-12 接悬停卡和定位到具体决策（参数里已经带着编号）
  const onRef = (_ref: string, refKind: RefKind) => {
    if (refKind === "decision") openProjectView({ cwd, view: "decisions", title: viewLabel("decisions") });
  };
  const startEdit = () => {
    if (!file) return;
    setDraft(file.text);
    setEditBase(file.mtimeMs);
    setConflict(false);
    setError(null);
  };
  const save = async (force = false) => {
    if (draft == null) return;
    const [stat] = await statFiles([path]).catch(() => [{ path, mtimeMs: null }]);
    if (!force && stat.mtimeMs !== editBase) return setConflict(true);
    try {
      await writeTextFile(path, draft);
      setDraft(null);
      setConflict(false);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  let body: React.ReactNode = null;
  if (file === null) body = <p className="text-[13px] text-content/50">{t("docs.missing")}</p>;
  else if (file && draft != null)
    body = (
      <div className="flex flex-col gap-2">
        <textarea
          autoFocus
          value={draft}
          rows={Math.max(16, draft.split("\n").length + 2)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter")) {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") setDraft(null);
          }}
          className="w-full resize-y rounded-md border border-stroke bg-content/5 p-3 font-mono text-[12px] leading-relaxed text-content outline-none"
        />
        {conflict ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/5 p-2 text-[12px] text-content/80">
            {t("docs.conflict")}
            <span className="ml-auto flex gap-1.5">
              <button type="button" onClick={() => void save(true)} className="h-7 rounded-md bg-content/10 px-2.5 hover:bg-content/15">{t("docs.overwrite")}</button>
              <button type="button" onClick={() => setDraft(null)} className="h-7 rounded-md px-2.5 text-content/60 hover:text-content">{t("docs.discard")}</button>
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-content/40">{t("docs.saveHint")}</span>
          <button type="button" onClick={() => setDraft(null)} className="ml-auto h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:text-content">{t("detail.cancel")}</button>
          <button type="button" onClick={() => void save()} className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:opacity-90">{t("docs.save")}</button>
        </div>
      </div>
    );
  else if (file && kind === "md")
    body = (
      <div
        // 引用在 markdown 里是 #soloyard-ref-D-12 的锚点：抢在底座的链接处理之前接管
        onClickCapture={(e) => {
          const a = (e.target as HTMLElement).closest(`a[href^="${REF_HREF}"]`);
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          const ref = a.getAttribute("href")!.slice(REF_HREF.length);
          onRef(ref, ref.startsWith("D") ? "decision" : "evidence");
        }}
        onContextMenuCapture={(e) => (e.target as HTMLElement).closest(`a[href^="${REF_HREF}"]`) && e.preventDefault()}
        className="[&_a[href^='#soloyard-ref-']]:mx-px [&_a[href^='#soloyard-ref-']]:rounded [&_a[href^='#soloyard-ref-']]:bg-accent/15 [&_a[href^='#soloyard-ref-']]:px-1 [&_a[href^='#soloyard-ref-']]:font-mono [&_a[href^='#soloyard-ref-']]:text-[0.9em] [&_a[href^='#soloyard-ref-']]:text-accent [&_a[href^='#soloyard-ref-']]:no-underline"
      >
        {file.text.trim() ? (
          <AgentMarkdown
            text={linkRefsInMarkdown(file.text)}
            streaming={false}
            hardBreaks
            cwd={path.slice(0, path.lastIndexOf("/"))}
            onOpenFile={(target) => {
              // 文档里链到某个 docs/ 下的另一篇（根目录或成员仓库）：在面板里打开
              if (/\/docs\//.test(target) && /\.(md|markdown|json)$/i.test(target)) {
                openProjectView({ cwd, view: "doc", itemId: target, title: basename(target) });
              }
            }}
          />
        ) : (
          <button type="button" onClick={startEdit} className="text-left text-[13px] text-content/40 hover:text-content/70">{t("docs.emptyDoc")}</button>
        )}
      </div>
    );
  else if (file) body = <JsonDoc text={file.text} decisions={decisions} onRef={onRef} onOpenFeatures={() => openProjectView({ cwd, view: "cycles", title: viewLabel("cycles") })} />;

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-content/40">
            <span className="truncate font-mono">{shown}</span>
            {file?.mtimeMs != null ? <span className="shrink-0">· {docTime(file.mtimeMs, i18n.language)}</span> : null}
            {kind === "md" && file && draft == null ? (
              <button type="button" onClick={startEdit} className="ml-auto shrink-0 text-[12px] text-content/50 hover:text-content">{t("detail.edit")}</button>
            ) : kind === "json" ? (
              <span className="ml-auto shrink-0" title={t("docs.readOnlyHint")}>{t("docs.readOnly")}</span>
            ) : null}
          </div>
          {kind === "json" ? <JsonTitle text={file?.text} fallback={basename(path)} /> : null}
          {isOverview ? <p className="text-[12px] text-content/50">{t("docs.autoHint")}</p> : null}
        </header>
        {error ? <p role="alert" className="text-[12px] text-red-400/90">{error}</p> : null}
        {body}
      </article>
    </div>
  );
}

const parse = (text: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

function JsonTitle({ text, fallback }: { text?: string; fallback: string }) {
  const parsed = text ? parse(text) : null;
  const doc = parsed?.ok ? asPtDoc(parsed.value) : null;
  return <h1 className="text-[20px] font-medium text-content">{typeof doc?.title === "string" ? doc.title : fallback}</h1>;
}

function JsonDoc({ text, ...ctx }: { text: string; decisions: Map<string, DecisionInfo>; onRef: (ref: string, kind: RefKind) => void; onOpenFeatures: () => void }) {
  const { t } = useTranslation("soloyard");
  const parsed = parse(text);
  if (!parsed.ok)
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-[12px] text-red-400/90">{t("docs.badJson", { error: parsed.error })}</p>
        <pre className="overflow-x-auto rounded-md bg-content/5 p-3 font-mono text-[11.5px] text-content/70">{text}</pre>
      </div>
    );
  const doc = asPtDoc(parsed.value);
  return doc ? <PtDocView doc={doc} {...ctx} /> : <RawJson value={parsed.value} />;
}
