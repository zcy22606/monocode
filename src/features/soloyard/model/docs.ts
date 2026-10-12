/**
 * Soloyard：Docs 页。文档以项目根目录 docs/ 里的文件为准（进 git），这里只读文件：
 * .md 按 markdown 显示（可编辑），product-thinking 的 .json（viewer/SCHEMA.md 的节 + 块）用块渲染器显示。
 */
import { useEffect, useRef } from "react";
import { listDir, statFiles } from "../../../platform/tauri/fs";

export type DocKind = "md" | "json";
export type DocEntry = {
  /** 相对 docs/ 的路径，也是 doc 详情的 itemId。 */
  rel: string;
  path: string;
  /** 所在子目录（相对 docs/），根下为 ""。 */
  dir: string;
  name: string;
  kind: DocKind;
  mtimeMs: number | null;
};

const DOC_FILE = /\.(md|markdown|json)$/i;
export const docKind = (name: string): DocKind => (/\.json$/i.test(name) ? "json" : "md");
export const docsRoot = (cwd: string) => `${cwd.replace(/\/+$/, "")}/docs`;
/** 另一个功能（SOL-70）每次 overview 变动时写的只读快照：列表标「自动生成」，点了去概览页。 */
export const isOverviewDoc = (rel: string) => rel.toLowerCase() === "overview.md";

// ponytail: 递归深度 6、不看隐藏文件 / node_modules，docs/ 里不该有更深的东西
const MAX_DEPTH = 6;

/** 扫 docs/（递归）。没有 docs/ 返回 null。按目录、文件名排序。 */
export async function scanDocs(cwd: string): Promise<DocEntry[] | null> {
  const root = docsRoot(cwd);
  const found: Omit<DocEntry, "mtimeMs">[] = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    const entries = await listDir(dir);
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDir) {
        if (depth < MAX_DEPTH) await walk(e.path, childRel, depth + 1).catch(() => undefined);
      } else if (DOC_FILE.test(e.name)) {
        found.push({ rel: childRel, path: e.path, dir: rel, name: e.name, kind: docKind(e.name) });
      }
    }
  };
  try {
    await walk(root, "", 0);
  } catch {
    return null; // 没有 docs/
  }
  const stats = await statFiles(found.map((f) => f.path)).catch(() => []);
  const mtime = new Map(stats.map((s) => [s.path, s.mtimeMs]));
  return sortDocs(found.map((f) => ({ ...f, mtimeMs: mtime.get(f.path) ?? null })));
}

/** 根目录的文件在前，再按目录、文件名。overview.md 放最前。 */
export function sortDocs(docs: DocEntry[]): DocEntry[] {
  return [...docs].sort(
    (a, b) =>
      Number(isOverviewDoc(b.rel)) - Number(isOverviewDoc(a.rel)) ||
      Number(!!a.dir) - Number(!!b.dir) ||
      a.dir.localeCompare(b.dir) ||
      a.name.localeCompare(b.name),
  );
}

/** 列表签名：文件增删或 mtime 变了才算变（轮询用，没变不触发重渲染）。 */
export const docsSignature = (docs: DocEntry[] | null) => (docs ? docs.map((d) => `${d.rel}:${d.mtimeMs}`).join("|") : "none");

/**
 * 文件会被 agent 在外面改：视图挂着、窗口可见时每隔几秒跑一次 tick（先立刻跑一次）。
 * ponytail: 底座没有文件监听，轮询 stat；docs/ 很小，几秒一次很便宜。文件多了再加 Rust 侧的 notify 监听。
 */
export function usePoll(tick: () => void, ms = 3000) {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    ref.current();
    const id = setInterval(() => document.visibilityState === "visible" && ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

// ───────────── D-x / E-x 引用 ─────────────

export type RefKind = "decision" | "evidence";
export type TextPart = string | { ref: string; kind: RefKind };

/** 决策 D-12 / DF-08、证据 E-3 / E-V-014。前后不能紧挨字母数字或 -（FEED-001、PRD-1 不算）。 */
const REF = /(?<![\w-])(?:DF|D|E(?:-[A-Z]+)?)-\d+(?![\w-])/g;
const refKind = (ref: string): RefKind => (ref.startsWith("D") ? "decision" : "evidence");

export function splitRefs(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ ref: m[0], kind: refKind(m[0]) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** markdown 里的引用改成锚点链接 `[D-12](#soloyard-ref-D-12)`，渲染后由外层按 href 接管点击；代码块、行内代码、已有链接里的不动。 */
export const REF_HREF = "#soloyard-ref-";
export function linkRefsInMarkdown(md: string): string {
  let fence: string | null = null;
  return md
    .split("\n")
    .map((line) => {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
        return line;
      }
      if (open) {
        fence = open[1];
        return line;
      }
      // 行内代码和已有链接 / 图片原样保留，其余部分换引用
      return line
        .split(/(`+[^`]*`+|!?\[[^\]]*\]\([^)]*\)|<[^>]+>)/)
        .map((part, i) => (i % 2 ? part : part.replace(REF, (ref) => `[${ref}](${REF_HREF}${ref})`)))
        .join("");
    })
    .join("\n");
}

// ───────────── product-thinking 文档（节 + 块） ─────────────

export type Block = { type?: unknown; [key: string]: unknown };
export type Section = { id?: string; title?: string; blocks?: unknown; sections?: unknown; collapsed?: boolean };
export type PtDoc = { id?: string; title?: string; meta?: unknown; lead?: unknown; sections: Section[] };

/** 是不是 SCHEMA 的文档：对象且有 sections 数组。 */
export function asPtDoc(value: unknown): PtDoc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  return Array.isArray(doc.sections) ? (doc as PtDoc) : null;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isArr = Array.isArray;
const isStrRows = (v: unknown) => isArr(v) && v.every((r) => isArr(r));

/** 每种块需要的字段；对不上的当不认识，显示成原始 JSON，不能因为 agent 写错一个字段白屏。 */
const BLOCK_SHAPES: Record<string, (b: Block) => boolean> = {
  text: (b) => isStr(b.text),
  list: (b) => isArr(b.items),
  kv: (b) => isArr(b.items),
  table: (b) => isArr(b.columns) && isStrRows(b.rows),
  cards: (b) => isArr(b.items),
  callout: (b) => isStr(b.text) || isStr(b.title) || isArr(b.items),
  checklist: (b) => isArr(b.items),
  details: (b) => isArr(b.blocks),
  code: (b) => isStr(b.text),
  quote: (b) => isStr(b.text),
  decision_ref: (b) => isArr(b.ids) || isStr(b.ids),
  chart: (b) => isArr(b.series),
  // 数据在 features.json：这里只放一个去迭代页的提示
  features_table: () => true,
  competitor_matrix: () => true,
};

export type BlockKind = keyof typeof BLOCK_SHAPES | "raw";
export function blockKind(block: unknown): BlockKind {
  if (!block || typeof block !== "object" || isArr(block)) return "raw";
  const type = (block as Block).type;
  return isStr(type) && BLOCK_SHAPES[type]?.(block as Block) ? type : "raw";
}

/** 图表先显示成表格：第一列是 x，每个系列一列；有单位写进表头。 */
export function chartToTable(block: Block): { caption?: string; columns: string[]; rows: string[][] } {
  const series = (block.series as { name?: unknown; values?: unknown }[]).filter((s) => s && typeof s === "object");
  const x = isArr(block.x) ? block.x : [];
  const length = Math.max(x.length, ...series.map((s) => (isArr(s.values) ? s.values.length : 0)));
  const unit = isStr(block.unit) && block.unit ? ` (${block.unit})` : "";
  return {
    caption: isStr(block.title) ? block.title : undefined,
    columns: ["", ...series.map((s, i) => `${s.name ?? i + 1}${unit}`)],
    rows: Array.from({ length }, (_, i) => [cell(x[i]), ...series.map((s) => cell(isArr(s.values) ? s.values[i] : undefined))]),
  };
}

export const cell = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** decision_ref 的 ids：数组或单个字符串。 */
export const refIds = (ids: unknown): string[] => (isArr(ids) ? ids.map(cell) : isStr(ids) ? [ids] : []);

export type DecisionInfo = { id: string; title?: string };
/** product-thinking 的 decisions.json → 编号（含别名）到标题；拿不到返回空表，卡片只显示编号。 */
export function decisionIndex(json: unknown): Map<string, DecisionInfo> {
  const out = new Map<string, DecisionInfo>();
  const list = json && typeof json === "object" ? (json as { decisions?: unknown }).decisions : undefined;
  for (const d of isArr(list) ? list : []) {
    if (!d || typeof d !== "object" || !isStr(d.id)) continue;
    const info = { id: d.id, title: isStr(d.title) ? d.title : undefined };
    out.set(d.id, info);
    for (const alias of isArr(d.aliases) ? d.aliases : []) if (isStr(alias)) out.set(alias, info);
  }
  return out;
}

// ───────────── 行内标记 ─────────────

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; text: string }
  | { t: "code"; text: string }
  | { t: "link"; text: string; href: string }
  | { t: "ref"; ref: string; kind: RefKind }
  | { t: "br" };

/** SCHEMA 第 6 节的行内标记：**粗体**、`代码`、[文字](链接)、换行，文字里的 D-x / E-x 变成引用。 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const plain = (s: string) => {
    s.split("\n").forEach((line, i) => {
      if (i) out.push({ t: "br" });
      for (const part of splitRefs(line)) {
        if (typeof part === "string") {
          if (part) out.push({ t: "text", text: part });
        } else out.push({ t: "ref", ...part });
      }
    });
  };
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    plain(text.slice(last, m.index));
    if (m[1] != null) out.push({ t: "bold", text: m[1] });
    else if (m[2] != null) out.push({ t: "code", text: m[2] });
    else out.push({ t: "link", text: m[3], href: m[4] });
    last = m.index! + m[0].length;
  }
  plain(text.slice(last));
  return out;
}
