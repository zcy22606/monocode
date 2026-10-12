import { Component, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../../../../i18n";
import {
  blockKind,
  cell,
  chartToTable,
  parseInline,
  refIds,
  type Block,
  type DecisionInfo,
  type PtDoc,
  type RefKind,
  type Section,
} from "../../model/docs";

export type OnRef = (ref: string, kind: RefKind) => void;
type Ctx = { onRef: OnRef; decisions: Map<string, DecisionInfo>; onOpenFeatures: () => void };

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : cell(v));

/** D-12 / E-3 引用。SOL-12 以后在这里接悬停卡。 */
export function RefChip({ id, kind, onRef }: { id: string; kind: RefKind; onRef: OnRef }) {
  return (
    <button
      type="button"
      onClick={() => onRef(id, kind)}
      className={`mx-px rounded px-1 font-mono text-[0.9em] ${kind === "decision" ? "bg-accent/15 text-accent hover:bg-accent/25" : "bg-content/10 text-content/75 hover:bg-content/15"}`}
    >
      {id}
    </button>
  );
}

/** 行内标记：粗体、代码、链接、换行、引用。 */
export function Inline({ text, onRef }: { text: unknown; onRef: OnRef }) {
  return (
    <>
      {parseInline(str(text)).map((part, i) => {
        switch (part.t) {
          case "bold":
            return <strong key={i} className="font-medium text-content">{part.text}</strong>;
          case "code":
            return <code key={i} className="rounded bg-content/10 px-1 font-mono text-[0.9em]">{part.text}</code>;
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                onClick={(e) => {
                  e.preventDefault();
                  if (/^https?:\/\//i.test(part.href)) void openUrl(part.href).catch(() => undefined);
                }}
                className="text-sky-400/90 hover:text-sky-300 hover:underline"
              >
                {part.text}
              </a>
            );
          case "ref":
            return <RefChip key={i} id={part.ref} kind={part.kind} onRef={onRef} />;
          case "br":
            return <br key={i} />;
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

/** 折叠的原始 JSON：不认识的块、不是 SCHEMA 的 json 文件。 */
export function RawJson({ value, label, open }: { value: unknown; label?: string; open?: boolean }) {
  const { t } = useTranslation("soloyard");
  return (
    <details open={open} className="rounded-md border border-stroke text-[12px]">
      <summary className="cursor-pointer select-none px-2 py-1 text-content/50 hover:text-content/80">{label ?? t("docs.rawJson")}</summary>
      <pre className="overflow-x-auto border-t border-stroke p-2 font-mono text-[11.5px] leading-relaxed text-content/70">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/** 一个块渲染出错（agent 写了奇怪的数据）只坏这一块：退回原始 JSON，不白屏。 */
class BlockBoundary extends Component<{ value: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RawJson value={this.props.value} /> : this.props.children;
  }
}

function Table({ columns, rows, caption, onRef }: { columns: unknown[]; rows: unknown[][]; caption?: unknown; onRef: OnRef }) {
  return (
    <figure className="flex flex-col gap-1">
      {caption ? <figcaption className="text-[12px] text-content/50"><Inline text={caption} onRef={onRef} /></figcaption> : null}
      <div className="max-h-[480px] overflow-auto rounded-md border border-stroke">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="sticky top-0 bg-background-base">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className="border-b border-stroke px-2 py-1.5 font-medium text-content/60">{str(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-stroke/60 last:border-b-0 align-top">
                {arr(row).map((c, i) => (
                  <td key={i} className="px-2 py-1.5 text-content/85"><Inline text={c} onRef={onRef} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function ListItems({ items, ordered, onRef }: { items: unknown[]; ordered?: boolean; onRef: OnRef }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`flex flex-col gap-0.5 pl-5 text-[13px] text-content/85 ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((item, i) => {
        const nested = item && typeof item === "object" && !Array.isArray(item) ? (item as { text?: unknown; items?: unknown }) : null;
        return (
          <li key={i}>
            <Inline text={nested ? nested.text : item} onRef={onRef} />
            {nested && Array.isArray(nested.items) ? <ListItems items={nested.items} ordered={ordered} onRef={onRef} /> : null}
          </li>
        );
      })}
    </Tag>
  );
}

const CALLOUT_TONE: Record<string, string> = {
  warn: "border-amber-400/40 bg-amber-400/5",
  danger: "border-red-400/40 bg-red-400/5",
  ok: "border-emerald-400/40 bg-emerald-400/5",
  info: "border-sky-400/40 bg-sky-400/5",
};
const CHECK_MARK: Record<string, [string, string]> = {
  pass: ["✓", "text-emerald-400"],
  partial: ["◐", "text-amber-400"],
  fail: ["✗", "text-red-400"],
  na: ["–", "text-content/40"],
};

function KvList({ items, onRef }: { items: unknown[]; onRef: OnRef }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px]">
      {items.map((item, i) => {
        const kv = (item ?? {}) as { k?: unknown; v?: unknown };
        return (
          <div key={i} className="contents">
            <dt className="text-content/50">{str(kv.k)}</dt>
            <dd className="text-content/85"><Inline text={kv.v} onRef={onRef} /></dd>
          </div>
        );
      })}
    </dl>
  );
}

function BlockView({ block, ctx }: { block: unknown; ctx: Ctx }) {
  const { t } = useTranslation("soloyard");
  const b = block as Block;
  const { onRef } = ctx;
  switch (blockKind(block)) {
    case "text":
      return (
        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-content/85">
          {str(b.text).split(/\n\s*\n/).map((p, i) => <p key={i}><Inline text={p} onRef={onRef} /></p>)}
        </div>
      );
    case "list":
      return <ListItems items={arr(b.items)} ordered={!!b.ordered} onRef={onRef} />;
    case "kv":
      return <KvList items={arr(b.items)} onRef={onRef} />;
    case "table":
      return <Table columns={arr(b.columns)} rows={arr(b.rows) as unknown[][]} caption={b.caption} onRef={onRef} />;
    case "chart": {
      const table = chartToTable(b);
      return <Table columns={table.columns} rows={table.rows} caption={table.caption} onRef={onRef} />;
    }
    case "cards":
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {arr(b.items).map((item, i) => {
            const card = (item ?? {}) as { title?: unknown; badge?: unknown; text?: unknown; kv?: unknown };
            return (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border border-stroke p-3">
                <div className="flex items-start gap-2 text-[13px] font-medium text-content">
                  <span className="min-w-0 flex-1"><Inline text={card.title} onRef={onRef} /></span>
                  {card.badge ? <span className="shrink-0 rounded bg-content/10 px-1.5 text-[11px] font-normal text-content/60">{str(card.badge)}</span> : null}
                </div>
                {card.text ? <p className="text-[12.5px] leading-relaxed text-content/75"><Inline text={card.text} onRef={onRef} /></p> : null}
                {Array.isArray(card.kv) ? <KvList items={card.kv} onRef={onRef} /> : null}
              </div>
            );
          })}
        </div>
      );
    case "callout":
      return (
        <div className={`flex flex-col gap-1 rounded-md border p-3 text-[13px] ${CALLOUT_TONE[str(b.tone)] ?? CALLOUT_TONE.info}`}>
          {b.title ? <div className="font-medium text-content"><Inline text={b.title} onRef={onRef} /></div> : null}
          {b.text ? <p className="leading-relaxed text-content/85"><Inline text={b.text} onRef={onRef} /></p> : null}
          {Array.isArray(b.items) ? <ListItems items={b.items} onRef={onRef} /> : null}
        </div>
      );
    case "checklist":
      return (
        <ul className="flex flex-col gap-1 text-[13px]">
          {arr(b.items).map((item, i) => {
            const c = (item ?? {}) as { text?: unknown; state?: unknown; note?: unknown };
            const [mark, color] = CHECK_MARK[str(c.state)] ?? CHECK_MARK.na;
            return (
              <li key={i} className="flex gap-2">
                <span className={`w-4 shrink-0 text-center ${color}`}>{mark}</span>
                <span className="text-content/85">
                  <Inline text={c.text} onRef={onRef} />
                  {c.note ? <span className="text-content/50"> — <Inline text={c.note} onRef={onRef} /></span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      );
    case "details":
      return (
        <details className="rounded-md border border-stroke">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-[13px] text-content/70 hover:text-content"><Inline text={b.summary} onRef={onRef} /></summary>
          <div className="border-t border-stroke p-3"><Blocks blocks={b.blocks} ctx={ctx} /></div>
        </details>
      );
    case "code":
      return <pre className="overflow-x-auto rounded-md bg-content/5 p-3 font-mono text-[12px] leading-relaxed text-content/80">{str(b.text)}</pre>;
    case "quote":
      return (
        <blockquote className="border-l-2 border-content/20 pl-3 text-[13px] italic text-content/75">
          <Inline text={b.text} onRef={onRef} />
          {b.source ? <footer className="mt-1 not-italic text-[12px] text-content/45">— <Inline text={b.source} onRef={onRef} /></footer> : null}
        </blockquote>
      );
    case "decision_ref":
      return (
        <div className="flex flex-col gap-1.5">
          {refIds(b.ids).map((id) => {
            const d = ctx.decisions.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onRef(d?.id ?? id, "decision")}
                className="flex items-center gap-2 rounded-md border border-stroke px-3 py-2 text-left text-[13px] hover:bg-content/5"
              >
                <span className="shrink-0 font-mono text-[12px] text-accent">{d?.id ?? id}</span>
                <span className="min-w-0 flex-1 truncate text-content/85">{d?.title ?? ""}</span>
              </button>
            );
          })}
        </div>
      );
    case "features_table":
    case "competitor_matrix":
      return (
        <button type="button" onClick={ctx.onOpenFeatures} className="w-fit rounded-md border border-dashed border-stroke px-3 py-2 text-left text-[12.5px] text-content/60 hover:bg-content/5 hover:text-content">
          {t(b.type === "features_table" ? "docs.featuresTable" : "docs.competitorMatrix")}
        </button>
      );
    default:
      return <RawJson value={block} label={t("docs.unknownBlock", { type: typeof b?.type === "string" ? b.type : "?" })} />;
  }
}

function Blocks({ blocks, ctx }: { blocks: unknown; ctx: Ctx }) {
  return (
    <div className="flex flex-col gap-3">
      {arr(blocks).map((block, i) => (
        <BlockBoundary key={i} value={block}>
          <BlockView block={block} ctx={ctx} />
        </BlockBoundary>
      ))}
    </div>
  );
}

function SectionView({ section, depth, ctx }: { section: Section; depth: number; ctx: Ctx }) {
  const heading = (
    <span className={depth ? "text-[14px] font-medium text-content" : "text-[16px] font-medium text-content"}>
      <Inline text={section.title} onRef={ctx.onRef} />
    </span>
  );
  const body = (
    <>
      <Blocks blocks={section.blocks} ctx={ctx} />
      {arr(section.sections).map((child, i) => (
        <SectionView key={i} section={(child ?? {}) as Section} depth={depth + 1} ctx={ctx} />
      ))}
    </>
  );
  return section.collapsed ? (
    <details className="flex flex-col gap-3">
      <summary className="cursor-pointer select-none">{heading}</summary>
      <div className="mt-3 flex flex-col gap-3">{body}</div>
    </details>
  ) : (
    <section className="flex flex-col gap-3">
      {section.title ? heading : null}
      {body}
    </section>
  );
}

/** product-thinking 的文档（viewer/SCHEMA.md 第 5 节）：标题、meta、lead 块、节（可嵌套、可折叠）+ 块。 */
export function PtDocView({ doc, ...ctx }: { doc: PtDoc } & Ctx) {
  return (
    <div className="flex flex-col gap-6">
      {Array.isArray(doc.meta) && doc.meta.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-content/50">
          {doc.meta.map((m, i) => <span key={i}><Inline text={m} onRef={ctx.onRef} /></span>)}
        </div>
      ) : null}
      {Array.isArray(doc.lead) ? <Blocks blocks={doc.lead} ctx={ctx} /> : null}
      {doc.sections.map((section, i) => (
        <BlockBoundary key={i} value={section}>
          <SectionView section={(section ?? {}) as Section} depth={0} ctx={ctx} />
        </BlockBoundary>
      ))}
    </div>
  );
}
