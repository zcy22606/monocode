/**
 * Soloyard：Docs 页（文档规范见 docs/soloyard/docs-convention.md）。文档以文件为准（进 git），数据库不存：
 * 数据进程（soloyard/core/src/docs.ts）列出项目根目录和成员仓库 docs/ 里的文档、解析文件头；这里分组、筛选。
 * .md 按 markdown 显示（可编辑），product-thinking 的 .json（viewer/SCHEMA.md 的节 + 块）用块渲染器显示。
 */
import { useEffect, useRef } from "react";

/** 类型目录，按显示顺序（和 soloyard/core/src/docs.ts 一致）。 */
export const DOC_TYPES = ["product", "specs", "architecture", "adr", "plans", "research", "reports", "runbooks", "archive"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type DocState = "draft" | "active" | "confirmed" | "done" | "partial" | "superseded" | "archived";

export type DocEntry = {
  /** 绝对路径，也是 doc 详情的 itemId。 */
  path: string;
  /** 成员仓库的路径；根目录的为 null。 */
  repo: string | null;
  repoName: string | null;
  /** 相对所在仓库 docs/ 的路径。 */
  rel: string;
  kind: "md" | "json";
  /** 不在类型目录里（不合规范）为 null。 */
  type: DocType | null;
  no: string | null;
  title: string;
  date: string | null;
  /** 日期从文件头来，还是退回了文件时间。 */
  dateFrom: "header" | "file";
  status: string | null;
  state: DocState | null;
  related: string | null;
  author: string | null;
  /** 根目录 docs/overview.md：产品说明书的快照。 */
  auto?: boolean;
  mtimeMs: number;
};

export type DocKind = "md" | "json";
export const docKind = (name: string): DocKind => (/\.json$/i.test(name) ? "json" : "md");
export const docsRoot = (cwd: string) => `${cwd.replace(/\/+$/, "")}/docs`;
/** 另一个功能（SOL-70）每次 overview 变动时写的只读快照：列表标「自动生成」，点了去概览页。 */
export const isOverviewDoc = (rel: string) => rel.toLowerCase() === "overview.md";
/** 详情页的 itemId：新的是绝对路径；之前存下的是相对根目录 docs/ 的路径。 */
export const docPath = (cwd: string, itemId: string) => (itemId.startsWith("/") ? itemId : `${docsRoot(cwd)}/${itemId}`);

/** 编号：类型/NN；编号文件夹里的带上自己的序号（reports/01/03）；归档里没编号的只写 archive。 */
export function docCode(d: Pick<DocEntry, "type" | "no" | "rel">) {
  if (!d.type) return null;
  if (!d.no) return d.type;
  const sub = /^(\d{2,})-/.exec(d.rel.split("/")[2] ?? "")?.[1];
  return sub ? `${d.type}/${d.no}/${sub}` : `${d.type}/${d.no}`;
}
/** 已废弃、已归档的默认藏起来。 */
export const isRetired = (d: Pick<DocEntry, "state">) => d.state === "superseded" || d.state === "archived";

export type DocFilter = { repos: Set<string>; showRetired: boolean; q: string };
const repoKey = (d: Pick<DocEntry, "repo">) => d.repo ?? "";
export function filterDocs(docs: DocEntry[], f: DocFilter) {
  const q = f.q.trim().toLowerCase();
  return docs.filter(
    (d) => !d.auto && (f.showRetired || !isRetired(d)) && (!f.repos.size || f.repos.has(repoKey(d))) && (!q || d.title.toLowerCase().includes(q) || d.rel.toLowerCase().includes(q)),
  );
}

export type DocGroupMode = "type" | "repo" | "time";
/** key：类型（未归类为 unsorted）、仓库路径（根目录为 ""）、或年月。 */
export type DocGroup = { key: string; docs: DocEntry[] };
const byDate = (a: DocEntry, b: DocEntry) => (a.date ?? "").localeCompare(b.date ?? "") || a.rel.localeCompare(b.rel);
const typeIndex = (d: DocEntry) => (d.type ? DOC_TYPES.indexOf(d.type) : DOC_TYPES.length);
/** 按编号：路径就是「类型/NN-…/NN-…」，数字感知地比路径即可。 */
const byNumber = (a: DocEntry, b: DocEntry) => a.rel.localeCompare(b.rel, undefined, { numeric: true });
/** 根目录在前，成员仓库按名字。 */
const byRepo = (a: DocEntry, b: DocEntry) => Number(!!a.repo) - Number(!!b.repo) || (a.repoName ?? "").localeCompare(b.repoName ?? "");

/**
 * 按类型：同一类里先根目录、再各仓库，按编号排，未归类放最后；
 * 按仓库：根目录在前，仓库里按类型、编号；时间线：按月份，新的在前。
 */
export function groupDocs(docs: DocEntry[], mode: DocGroupMode): DocGroup[] {
  const groups = new Map<string, DocEntry[]>();
  const add = (key: string, d: DocEntry) => groups.set(key, [...(groups.get(key) ?? []), d]);
  if (mode === "type") {
    for (const t of [...DOC_TYPES, "unsorted"]) groups.set(t, []);
    for (const d of docs) add(d.type ?? "unsorted", d);
    for (const list of groups.values()) list.sort((a, b) => byRepo(a, b) || byNumber(a, b));
  } else if (mode === "repo") {
    for (const d of [...docs].sort(byRepo)) add(repoKey(d), d);
    for (const list of groups.values()) list.sort((a, b) => typeIndex(a) - typeIndex(b) || byNumber(a, b));
  } else {
    for (const d of [...docs].sort((a, b) => byDate(b, a))) add((d.date ?? "").slice(0, 7), d);
  }
  return [...groups].filter(([, list]) => list.length).map(([key, list]) => ({ key, docs: list }));
}

/** 列表签名：文件增删、mtime 或解析结果变了才算变（轮询用，没变不触发重渲染）。 */
export const docsSignature = (docs: DocEntry[] | null) => (docs ? docs.map((d) => `${d.path}:${d.mtimeMs}`).join("|") : "none");

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
