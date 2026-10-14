/**
 * 文档规范（docs/soloyard/docs-convention.md）：每个仓库一个 docs/，按类型分目录，文件名 `NN-中文标题`，开头写日期、状态、关联。
 * 这里只读写文件，数据库不存文档：
 * - listDocs：项目根目录和成员仓库 docs/ 里的文档，解析文件头（列表、表格、front matter 三种写法都认）；
 * - newDoc：按规范建一篇（该类型目录里的编号续上、文件头写好），agent 经 MCP new_doc、界面「新建文档」都走它。
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DB } from './db.ts'
import { findProjectByPath, type Row } from './repo.ts'

/**
 * 文档规范的要点（全文见 docs/soloyard/docs-convention.md）。MCP 的 instructions 和「整理文档」的提示词都用这一份：
 * 会话不一定连着 MCP（终端里直接跑的 agent、别的工具），提示词里要自带规范。
 */
export const DOC_CONVENTION = `文档规范：
- 每个仓库一个 docs/：跨仓库、项目级的放项目根目录的 docs/，只关于一个成员仓库的放那个仓库的 docs/。
- 按类型分目录：product 产品 / specs 规格 / architecture 架构 / adr 决策 / plans 计划 / research 调研 / reports 报告 / runbooks 手册 / archive 归档。
- 文件名 NN-中文标题.md：NN 是该目录里的两位序号，从现有最大号续编，不用日期前缀；代码标识符保持英文；一组多篇的整个文件夹编号（reports/03-审计/00-总览.md）。
- 开头写「- 日期：」「- 状态：」（草稿 / 进行中 / 已确认 / 已结束 / 部分被取代 / 已废弃 / 已归档）「- 作者：」「- 关联：」。
- 被取代的不删：状态改「已废弃」、写明取代者、挪进 archive/；已经在 archive/ 里的保持原名。内容完全相同的副本只留一份（放在按规范该放的位置）。
- README / AGENTS / CLAUDE / CHANGELOG 不改名、不编号；随代码发布或给外部看的材料（公开文档、给客户或投资人的）保持原样。
- *.secrets* 这类凭据文件不读、不引用；在文档里看到明文密钥（API key、密码、私钥），不复制到别处，单独提醒用户轮换。
- 事实、决策、计划、假设和没解决的问题分开写，不把猜测写成结论。`

/** 类型目录，按显示顺序。archive 是归档（被取代、过时的，不删）。 */
export const DOC_TYPES = ['product', 'specs', 'architecture', 'adr', 'plans', 'research', 'reports', 'runbooks', 'archive'] as const
export type DocType = (typeof DOC_TYPES)[number]
const isType = (s: string): s is DocType => (DOC_TYPES as readonly string[]).includes(s)

/** 状态归成几类（原文照留）：草稿、进行中、已确认、已结束、部分被取代、已废弃、已归档。 */
export type DocState = 'draft' | 'active' | 'confirmed' | 'done' | 'partial' | 'superseded' | 'archived'
const STATE_WORDS: [DocState, RegExp][] = [
  ['partial', /部分.{0,12}取代|partially superseded/i],
  ['superseded', /废弃|作废|被.{0,12}取代|superseded|deprecated|obsolete/i],
  ['archived', /归档|archived/i],
  ['done', /结束|止损|\bdone\b|\bclosed\b/i],
  ['confirmed', /确认|定案|accepted|approved|in force/i],
  ['active', /进行中|持续更新|in progress|ongoing/i],
  ['draft', /草稿|待执行|评审|draft|proposed/i],
]
/** 只看状态原文的开头一句（后面常跟着复核说明，里面的词不算），取最先出现的词：「已归档（superseded）」算已归档。 */
export function docState(raw: string | null | undefined): DocState | null {
  const head = (raw ?? '').replace(/[*_`]/g, '').split(/[。；;\n]/)[0].slice(0, 60)
  let best: { state: DocState; at: number } | null = null
  for (const [state, re] of STATE_WORDS) {
    const at = head.search(re)
    if (at >= 0 && (!best || at < best.at)) best = { state, at }
  }
  return best?.state ?? null
}

export type DocHeader = { title?: string; date?: string; status?: string; author?: string; related?: string; supersedes?: string }
const KEYS: Record<string, Exclude<keyof DocHeader, 'title'>> = {
  日期: 'date', date: 'date', 状态: 'status', status: 'status', 作者: 'author', author: 'author',
  关联: 'related', related: 'related', 取代: 'supersedes', supersedes: 'supersedes',
}

/**
 * 文件头：第一个 `# 标题`，以及第一个 `## ` 之前的「- 日期：…」列表、「| **日期** | … |」表格，或开头的 `---` front matter。
 * 每个字段取第一次出现的。
 */
export function parseHeader(text: string): DocHeader {
  const out: DocHeader = {}
  const set = (key: string, value: string) => {
    const k = KEYS[key.toLowerCase()]
    const v = value.replace(/\*\*/g, '').replace(/\|\s*$/, '').trim()
    if (k && v && !out[k]) out[k] = v
  }
  const lines = text.split(/\r?\n/)
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const m = /^([\p{L}_]+)\s*:\s*(.*)$/u.exec(lines[i].trim())
      if (m) set(m[1], m[2].replace(/^["']|["']$/g, ''))
    }
    i++
  }
  for (const end = Math.min(lines.length, i + 60); i < end; i++) {
    const line = lines[i].trim()
    if (/^##\s/.test(line)) break
    if (!out.title && /^#\s+/.test(line)) {
      out.title = line.replace(/^#\s+/, '').trim()
      continue
    }
    const m = /^(?:[-*]\s*)?\**([\p{L}]+)\**\s*[:：]\s*(.+)$/u.exec(line) ?? /^\|\s*\**([\p{L}]+)\**\s*\|\s*(.+)$/u.exec(line)
    if (m) set(m[1], m[2])
  }
  return out
}

/** 日期取第一个 YYYY-MM-DD。 */
const dateOf = (s?: string) => /\d{4}-\d{2}-\d{2}/.exec(s ?? '')?.[0] ?? null

export type DocEntry = {
  path: string
  /** 成员仓库的路径；根目录的文档为 null。 */
  repo: string | null
  repoName: string | null
  /** 相对所在仓库 docs/ 的路径。 */
  rel: string
  kind: 'md' | 'json'
  /** 在类型目录里才有；不合规范的为 null（「未归类」）。 */
  type: DocType | null
  /** 类型目录下第一层的两位编号（文件或编号文件夹）。 */
  no: string | null
  title: string
  date: string | null
  /** 日期从哪来：文件头，或者退回文件的创建时间。 */
  dateFrom: 'header' | 'file'
  status: string | null
  state: DocState | null
  related: string | null
  author: string | null
  /** 根目录 docs/overview.md：产品说明书的自动快照。 */
  auto?: boolean
  mtimeMs: number
}

const DOC_FILE = /\.(md|markdown|json)$/i
/** 凭据文件（*.secrets.local.md 这类）永不列出，也就不会被当成上下文发给 agent。 */
const SECRET = /(^|[.\-_])(secrets?|credentials?)([.\-_]|$)|^\.env/i
const MAX_DEPTH = 6
const HEAD_BYTES = 6144

function readHead(path: string) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    return buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_BYTES, 0))
  } finally {
    closeSync(fd)
  }
}

/** 解析结果按 mtime 缓存：文档页几秒轮询一次，没变的文件不重读。 */
const cache = new Map<string, { mtimeMs: number; size: number; head: DocHeader }>()

function headerOf(path: string, kind: 'md' | 'json', mtimeMs: number, size: number): DocHeader {
  const hit = cache.get(path)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.head
  let head: DocHeader = {}
  try {
    const text = readHead(path)
    if (kind === 'md') head = parseHeader(text)
    else {
      // product-thinking 的节 + 块：title 和 meta 在开头
      const str = (k: string) => new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1]
      head = { title: str('title'), date: str('date'), status: str('status'), author: str('author') }
    }
  } catch {
    // 读不了就只用文件名
  }
  cache.set(path, { mtimeMs, size, head })
  return head
}

export type DocRoot = { path: string; repo: string | null; name: string | null }

/** 项目的文档根：根目录，加上每个成员仓库。不在任何项目里时只有 cwd 自己。 */
export function docRoots(db: DB, cwd: string): DocRoot[] {
  const p = findProjectByPath(db, cwd)
  if (!p) return [{ path: cwd.replace(/\/+$/, ''), repo: null, name: null }]
  const root = (db.prepare('SELECT path FROM soloyard_project_paths WHERE project_id = ? ORDER BY length(path) LIMIT 1').get(p.id) as Row).path as string
  const repos = db.prepare('SELECT path FROM soloyard_project_repos WHERE project_id = ? ORDER BY sort, id').all(p.id) as Row[]
  return [{ path: root, repo: null, name: null }, ...repos.map((r) => ({ path: r.path as string, repo: r.path as string, name: basename(r.path as string) }))]
}

/** 项目里所有文档：每个文档根的 docs/ 递归（不进隐藏目录和 node_modules，跳过凭据）。按类型、编号排。 */
export function listDocs(db: DB, cwd: string): DocEntry[] {
  const out: DocEntry[] = []
  for (const root of docRoots(db, cwd)) {
    const docs = join(root.path, 'docs')
    if (!existsSync(docs)) continue
    const walk = (dir: string, rel: string, depth: number) => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || SECRET.test(e.name)) continue
        const childRel = rel ? `${rel}/${e.name}` : e.name
        const path = join(dir, e.name)
        if (e.isDirectory()) {
          if (depth < MAX_DEPTH) walk(path, childRel, depth + 1)
          continue
        }
        if (!DOC_FILE.test(e.name)) continue
        let st
        try {
          st = statSync(path)
        } catch {
          continue
        }
        const kind = /\.json$/i.test(e.name) ? 'json' : 'md'
        const head = headerOf(path, kind, st.mtimeMs, st.size)
        const segs = childRel.split('/')
        const type = segs.length >= 2 && isType(segs[0]) ? segs[0] : null
        const no = type ? (/^(\d{2,})-/.exec(segs[1])?.[1] ?? null) : null
        const headerDate = dateOf(head.date)
        out.push({
          path, repo: root.repo, repoName: root.name, rel: childRel, kind, type, no,
          title: head.title || e.name.replace(DOC_FILE, '').replace(/^\d{2,}-/, ''),
          date: headerDate ?? new Date(st.birthtimeMs || st.mtimeMs).toLocaleDateString('sv-SE'),
          dateFrom: headerDate ? 'header' : 'file',
          status: head.status ?? null,
          state: docState(head.status) ?? (type === 'archive' ? 'archived' : null),
          related: head.related ?? null, author: head.author ?? null,
          ...(root.repo === null && childRel === 'overview.md' ? { auto: true } : {}),
          mtimeMs: st.mtimeMs,
        })
      }
    }
    walk(docs, '', 0)
  }
  const order = (d: DocEntry) => (d.type ? DOC_TYPES.indexOf(d.type) : DOC_TYPES.length)
  return out.sort((a, b) => order(a) - order(b) || (a.no ?? '').localeCompare(b.no ?? '') || a.rel.localeCompare(b.rel))
}

/** 类型目录里的下一个编号：现有最大号 + 1，两位。 */
export function nextNumber(dir: string) {
  const used = existsSync(dir) ? readdirSync(dir).map((f) => Number(/^(\d{2,})-/.exec(f)?.[1] ?? 0)) : []
  return String(Math.max(0, ...used) + 1).padStart(2, '0')
}

/** 标题 → 文件名：中文两边的空格去掉，其余空白换成短横线，去掉文件名不能用的字符。 */
export function fileTitle(title: string) {
  return title
    .trim()
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s*([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])\s*/g, '$1')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
}

export type NewDocInput = { type: string; title: string; repo?: string | null; kind?: 'md' | 'json'; author?: string; related?: string }

/** 按规范建一篇文档：放进 <仓库>/docs/<类型>/NN-标题.md，文件头写好（状态草稿）。返回路径和编号。 */
export function newDoc(db: DB, cwd: string, input: NewDocInput) {
  if (!isType(input.type) || input.type === 'archive') throw new Error(`类型只能是 ${DOC_TYPES.filter((t) => t !== 'archive').join(' / ')}（归档是挪进 archive/，不新建）`)
  const title = input.title?.trim()
  if (!title) throw new Error('要有标题')
  const roots = docRoots(db, cwd)
  const base = input.repo ? roots.find((r) => r.repo && (r.repo === input.repo || r.name === input.repo)) : roots[0]
  if (!base) throw new Error(`找不到仓库 ${input.repo}，可选：${roots.filter((r) => r.repo).map((r) => r.name).join(', ') || '（这个项目没有成员仓库）'}；跨仓库的文档不传 repo，放根目录`)
  const dir = join(base.path, 'docs', input.type)
  mkdirSync(dir, { recursive: true })
  const kind = input.kind === 'json' ? 'json' : 'md'
  const date = new Date().toLocaleDateString('sv-SE')
  const author = input.author?.trim() || '—'
  // 两个会话同时建同一类型时编号会撞：撞了重算
  for (let attempt = 0; attempt < 5; attempt++) {
    const no = nextNumber(dir)
    const path = join(dir, `${no}-${fileTitle(title)}.${kind}`)
    const content =
      kind === 'json'
        ? JSON.stringify({ id: `${no}-${fileTitle(title)}`, title, meta: { date, status: '草稿', author }, sections: [] }, null, 2) + '\n'
        : [`# ${input.type === 'adr' ? `ADR ${no}：` : ''}${title}`, '', `- 日期：${date}`, '- 状态：草稿', `- 作者：${author}`, ...(input.related?.trim() ? [`- 关联：${input.related.trim()}`] : []), '', ''].join('\n')
    try {
      writeFileSync(path, content, { flag: 'wx' })
      return { path, code: `${input.type}/${no}`, repo: base.name }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error('编号一直冲突，稍后再试')
}
