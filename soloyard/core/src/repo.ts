import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { DB } from './db.ts'
import { tx } from './db.ts'

/** 谁在写：'user' 或 'agent:<名字>'。记进 soloyard_changes，历史和撤销据此区分。 */
export type Actor = string
export type Row = Record<string, any>

const now = () => new Date().toISOString()
/** 逻辑实体名 → 表名。代码里和变更记录里都用逻辑名（'issues'），只有拼 SQL 时加前缀。 */
const T = (entity: string) => `soloyard_${entity}`

/** 每个实体允许 update 改的列；不在表里的键一律忽略，防止 agent 改 id / version。 */
const WRITABLE: Record<string, string[]> = {
  projects: ['name', 'goal', 'stage', 'archived', 'next_step', 'stoploss_json', 'meta_json'],
  issues: ['title', 'body_md', 'status', 'priority', 'labels', 'due_date', 'cycle_id', 'milestone_id', 'parent_id', 'feature_id', 'iteration_id', 'sort_key', 'completed_at'],
  acceptance: ['text', 'done', 'sort'],
  iterations: ['tag', 'name', 'goal', 'target_date', 'status', 'sort', 'summary_json', 'started_at', 'completed_at'],
  features: ['name', 'backbone', 'module', 'layer', 'level', 'tier', 'data_json', 'iteration_id', 'bucket', 'sort', 'ai_plan'],
  documents: ['kind', 'title', 'body_md', 'blocks_json'],
  decisions: ['title', 'door', 'status', 'data_json'],
}
const VERSIONED = new Set(['projects', 'ideas', 'documents', 'decisions', 'features', 'milestones', 'cycles', 'issues', 'iterations'])

export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const

export class VersionConflict extends Error {
  latest: Row
  constructor(latest: Row) {
    super(`version conflict: latest version is ${latest.version}`)
    this.latest = latest
  }
}

function logChange(db: DB, actor: Actor, entity: string, id: number, op: string, before: Row | null, after: Row | null, batch?: string) {
  db.prepare('INSERT INTO soloyard_changes (at, actor, entity, entity_id, op, before_json, after_json, batch) VALUES (?,?,?,?,?,?,?,?)').run(
    now(), actor, entity, id, op, before && JSON.stringify(before), after && JSON.stringify(after), batch ?? null,
  )
}

export function getRow(db: DB, entity: string, id: number): Row | undefined {
  return db.prepare(`SELECT * FROM ${T(entity)} WHERE id = ?`).get(id) as Row | undefined
}

export function insert(db: DB, actor: Actor, entity: string, row: Row, batch?: string): number {
  const r = { ...row }
  if (VERSIONED.has(entity)) Object.assign(r, { created_at: now(), updated_at: now(), version: 1 })
  const cols = Object.keys(r)
  const res = db.prepare(`INSERT INTO ${T(entity)} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c]))
  const id = Number(res.lastInsertRowid)
  logChange(db, actor, entity, id, 'create', null, getRow(db, entity, id)!, batch)
  return id
}

export function update(db: DB, actor: Actor, entity: string, id: number, patch: Row, expectedVersion?: number, batch?: string): Row {
  const before = getRow(db, entity, id)
  if (!before) throw new Error(`${entity} ${id} not found`)
  if (expectedVersion != null && before.version !== expectedVersion) throw new VersionConflict(before)
  const keys = Object.keys(patch).filter((k) => WRITABLE[entity]?.includes(k) && patch[k] !== before[k])
  if (!keys.length) return before
  const sets = keys.map((k) => `${k} = ?`)
  const vals = keys.map((k) => patch[k])
  if (VERSIONED.has(entity)) { sets.push('updated_at = ?', 'version = version + 1'); vals.push(now()) }
  db.prepare(`UPDATE ${T(entity)} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  const after = getRow(db, entity, id)!
  logChange(db, actor, entity, id, 'update', before, after, batch)
  return after
}

export function remove(db: DB, actor: Actor, entity: string, id: number, batch?: string) {
  const before = getRow(db, entity, id)
  if (!before) return
  db.prepare(`DELETE FROM ${T(entity)} WHERE id = ?`).run(id)
  logChange(db, actor, entity, id, 'delete', before, null, batch)
}

/**
 * 回滚一次变更：create → 删掉，update → 写回 before，delete → 按原 id 重建。回滚本身记 batch = revert:<原 id>。
 * ponytail: 删除时级联掉的子行（如 issue 的验收项）不随之恢复；需要时按 batch 成组回滚。
 */
export function revertChange(db: DB, actor: Actor, changeId: number, prefix: 'revert' | 'redo' = 'revert') {
  const c = db.prepare('SELECT * FROM soloyard_changes WHERE id = ?').get(changeId) as Row | undefined
  if (!c) throw new Error(`change ${changeId} not found`)
  const before = c.before_json && JSON.parse(c.before_json)
  const batch = `${prefix}:${changeId}`
  if (c.op === 'create') remove(db, actor, c.entity, c.entity_id, batch)
  else if (c.op === 'update') update(db, actor, c.entity, c.entity_id, before, undefined, batch)
  else {
    const cols = Object.keys(before)
    db.prepare(`INSERT INTO ${T(c.entity)} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => before[k]))
    logChange(db, actor, c.entity, c.entity_id, 'create', null, before, batch)
  }
}

/** ⌘Z：回滚该 actor 最近一次还没被回滚过的变更，连按一步步往回退。 */
export function undoLast(db: DB, actor: Actor = 'user') {
  const c = db.prepare(`SELECT id FROM soloyard_changes c WHERE actor = ? AND (batch IS NULL OR batch NOT LIKE 'revert:%')
    AND NOT EXISTS (SELECT 1 FROM soloyard_changes r WHERE r.batch = 'revert:' || c.id) ORDER BY id DESC LIMIT 1`).get(actor) as Row | undefined
  if (c) revertChange(db, actor, c.id)
  return c?.id ?? null
}

/** ⌘⇧Z：把最近一次撤销做回来；撤销之后又有新修改就没有可重做的了。 */
export function redoLast(db: DB, actor: Actor = 'user') {
  const c = db.prepare(`SELECT id FROM soloyard_changes c WHERE actor = ? AND batch LIKE 'revert:%'
    AND NOT EXISTS (SELECT 1 FROM soloyard_changes r WHERE r.batch IN ('redo:' || c.id, 'revert:' || c.id))
    AND id > COALESCE((SELECT MAX(id) FROM soloyard_changes n WHERE n.actor = ? AND (n.batch IS NULL OR (n.batch NOT LIKE 'revert:%' AND n.batch NOT LIKE 'redo:%'))), 0)
    ORDER BY id DESC LIMIT 1`).get(actor, actor) as Row | undefined
  if (c) revertChange(db, actor, c.id, 'redo')
  return c?.id ?? null
}

// ───────────── 项目：一个文件夹对应一个项目 ─────────────

/** issue 编号前缀：取名字里前 3 个英文字母大写，冲突时补数字。 */
function makeKey(db: DB, name: string) {
  const base = (name.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'PRJ').toUpperCase()
  let key = base
  for (let i = 2; db.prepare('SELECT 1 FROM soloyard_projects WHERE key = ?').get(key); i++) key = `${base}${i}`
  return key
}

export function createProject(db: DB, actor: Actor, p: { name: string; goal?: string; key?: string; path?: string }) {
  return tx(db, () => {
    const id = insert(db, actor, 'projects', { name: p.name, goal: p.goal ?? '', key: p.key ?? makeKey(db, p.name) })
    if (p.path) db.prepare('INSERT INTO soloyard_project_paths (project_id, path) VALUES (?, ?)').run(id, p.path)
    return id
  })
}

export function findProject(db: DB, idOrKey: number | string): Row | undefined {
  return typeof idOrKey === 'number' || /^\d+$/.test(String(idOrKey))
    ? getRow(db, 'projects', Number(idOrKey))
    : (db.prepare('SELECT * FROM soloyard_projects WHERE key = ?').get(String(idOrKey).toUpperCase()) as Row | undefined)
}

/** 包含这个路径的项目（关联目录是它本身或它的上级，取最具体的那个）；不新建。 */
export function findProjectByPath(db: DB, path: string): Row | undefined {
  const clean = path.replace(/\/+$/, '')
  const rows = db.prepare('SELECT p.*, pp.path AS matched, pp.recursive FROM soloyard_project_paths pp JOIN soloyard_projects p ON p.id = pp.project_id').all() as Row[]
  return rows
    // 子目录只在关联目录标了「含子目录」时才算（~/Playground 这种父目录通常不含）
    .filter((r) => clean === r.matched || (r.recursive && clean.startsWith(r.matched.replace(/\/+$/, '') + '/')))
    .sort((a, b) => b.matched.length - a.matched.length)[0]
}

/** 这个文件夹对应的项目；还没有就按文件夹名建一个（第一次打开 Project 分页时）。 */
export function projectForPath(db: DB, path: string): Row {
  const hit = db.prepare('SELECT p.* FROM soloyard_projects p JOIN soloyard_project_paths pp ON pp.project_id = p.id WHERE pp.path = ?').get(path) as Row | undefined
  if (hit) return hit
  return getRow(db, 'projects', createProject(db, 'user', { name: basename(path) || path, path }))!
}

// ───────────── Issue ─────────────

export type NewIssue = {
  title: string; body_md?: string; status?: string; priority?: number; labels?: string[]; due_date?: string
  cycle_id?: number; milestone_id?: number; parent_id?: number; feature_id?: number; iteration_id?: number; acceptance?: string[]; blocked_by?: number[]
}

export function createIssue(db: DB, actor: Actor, projectId: number, i: NewIssue, batch?: string) {
  return tx(db, () => {
    const p = db.prepare('UPDATE soloyard_projects SET issue_seq = issue_seq + 1 WHERE id = ? RETURNING issue_seq').get(projectId) as Row | undefined
    if (!p) throw new Error(`project ${projectId} not found`)
    const id = insert(db, actor, 'issues', {
      project_id: projectId, number: p.issue_seq, title: i.title, body_md: i.body_md ?? '', status: i.status ?? 'backlog',
      priority: i.priority ?? 0, labels: JSON.stringify(i.labels ?? []), due_date: i.due_date ?? null, cycle_id: i.cycle_id ?? null,
      milestone_id: i.milestone_id ?? null, parent_id: i.parent_id ?? null, feature_id: i.feature_id ?? null, iteration_id: i.iteration_id ?? null, sort_key: Date.now(),
    }, batch)
    i.acceptance?.forEach((text, sort) => insert(db, actor, 'acceptance', { issue_id: id, text, sort }, batch))
    for (const b of i.blocked_by ?? []) db.prepare('INSERT OR IGNORE INTO soloyard_issue_deps (issue_id, blocked_by_id) VALUES (?, ?)').run(id, b)
    return id
  })
}

/** 改 issue；状态变成 done 时记 completed_at，离开 done 时清掉。 */
export function updateIssue(db: DB, actor: Actor, id: number, patch: Row, expectedVersion?: number) {
  const p = { ...patch }
  if (Array.isArray(p.labels)) p.labels = JSON.stringify(p.labels)
  if (p.status === 'done') p.completed_at = now()
  else if (p.status) p.completed_at = null
  return update(db, actor, 'issues', id, p, expectedVersion)
}

export type IssueFilter = { projectId?: number; status?: string[]; ready?: boolean; q?: string; includeSubIssues?: boolean }

/** 列 issue（筛选、分组、排序在界面做；这里只按项目 / 状态 / 关键词粗筛）。ready = 未开始且前置都已完成。 */
export function listIssues(db: DB, f: IssueFilter = {}) {
  const where: string[] = []
  const args: any[] = []
  if (!f.includeSubIssues) where.push('i.parent_id IS NULL')
  if (f.projectId != null) { where.push('i.project_id = ?'); args.push(f.projectId) }
  if (f.status?.length) { where.push(`i.status IN (${f.status.map(() => '?').join(',')})`); args.push(...f.status) }
  if (f.q) { where.push("(i.title LIKE ? OR i.body_md LIKE ? OR p.key || '-' || i.number LIKE ?)"); args.push(`%${f.q}%`, `%${f.q}%`, `${f.q}%`) }
  if (f.ready) where.push(`i.status IN ('backlog','todo') AND NOT EXISTS (
    SELECT 1 FROM soloyard_issue_deps d JOIN soloyard_issues b ON b.id = d.blocked_by_id WHERE d.issue_id = i.id AND b.status NOT IN ('done','canceled'))`)
  const rows = db.prepare(`
    SELECT i.*, p.key || '-' || i.number AS ident,
      (SELECT COUNT(*) FROM soloyard_issues c WHERE c.parent_id = i.id) AS children,
      (SELECT COUNT(*) FROM soloyard_issues c WHERE c.parent_id = i.id AND c.status = 'done') AS children_done,
      (SELECT COUNT(*) FROM soloyard_session_links l WHERE l.kind = 'issue' AND l.target = CAST(i.id AS TEXT)
        ${hasBaseSessions(db) ? 'AND l.session_id IN (SELECT id FROM sessions)' : ''}) AS sessions
    FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.sort_key`).all(...args) as Row[]
  return rows.map((r) => ({ ...r, labels: JSON.parse(r.labels) as string[] }))
}

/** 同一个库里有没有底座的会话表；单测的内存库里没有。 */
function hasBaseSessions(db: DB) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()
}

/** 关联的会话按底座的会话表补上标题；会话第一次发送后才入库，查不到的标 missing。 */
function baseSessions(db: DB, ids: string[]): Row[] {
  if (!ids.length) return []
  if (!hasBaseSessions(db)) return ids.map((id) => ({ id }))
  const found = db.prepare(`SELECT id, title, harness, updated_at FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[]
  return ids.map((id) => found.find((s) => s.id === id) ?? { id, missing: true })
}

/** issue 引用：数字 id 或编号（如 SOL-12）。 */
export function findIssueId(db: DB, ref: number | string): number {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return Number(ref)
  const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(String(ref).trim())
  const hit = m && (db.prepare('SELECT i.id FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id WHERE p.key = ? AND i.number = ?').get(m[1].toUpperCase(), Number(m[2])) as Row | undefined)
  if (!hit) throw new Error(`找不到 issue ${ref}（用 list_issues 查编号）`)
  return hit.id
}

export function listProjects(db: DB): Row[] {
  return db.prepare(`SELECT p.id, p.key, p.name, p.goal,
      (SELECT GROUP_CONCAT(path, char(10)) FROM soloyard_project_paths WHERE project_id = p.id) AS paths,
      (SELECT COUNT(*) FROM soloyard_issues i WHERE i.project_id = p.id AND i.parent_id IS NULL AND i.status NOT IN ('done','canceled')) AS open_issues,
      (SELECT COUNT(*) FROM soloyard_issues i WHERE i.project_id = p.id AND i.status = 'in_review') AS in_review
    FROM soloyard_projects p WHERE p.archived = 0 ORDER BY p.updated_at DESC`).all() as Row[]
}

export function getIssue(db: DB, id: number) {
  const issue = db.prepare("SELECT i.*, p.key || '-' || i.number AS ident FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id WHERE i.id = ?").get(id) as Row | undefined
  if (!issue) return undefined
  const sessionIds = (db.prepare("SELECT session_id FROM soloyard_session_links WHERE kind = 'issue' AND target = ? ORDER BY created_at DESC").all(String(id)) as Row[]).map((r) => r.session_id as string)
  return {
    ...issue,
    labels: JSON.parse(issue.labels) as string[],
    acceptance: db.prepare('SELECT * FROM soloyard_acceptance WHERE issue_id = ? ORDER BY sort, id').all(id) as Row[],
    children: db.prepare("SELECT i.id, p.key || '-' || i.number AS ident, i.title, i.status FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id WHERE i.parent_id = ? ORDER BY i.sort_key").all(id) as Row[],
    blockedBy: db.prepare("SELECT b.id, p.key || '-' || b.number AS ident, b.title, b.status FROM soloyard_issue_deps d JOIN soloyard_issues b ON b.id = d.blocked_by_id JOIN soloyard_projects p ON p.id = b.project_id WHERE d.issue_id = ?").all(id) as Row[],
    comments: db.prepare('SELECT * FROM soloyard_comments WHERE issue_id = ? ORDER BY id').all(id) as Row[],
    sessions: baseSessions(db, sessionIds),
  }
}

export function addAcceptance(db: DB, actor: Actor, issueId: number, text: string) {
  const n = Number((db.prepare('SELECT COUNT(*) AS n FROM soloyard_acceptance WHERE issue_id = ?').get(issueId) as Row).n)
  return insert(db, actor, 'acceptance', { issue_id: issueId, text, sort: n })
}
export const updateAcceptance = (db: DB, actor: Actor, id: number, patch: Row) => update(db, actor, 'acceptance', id, patch)
export const removeAcceptance = (db: DB, actor: Actor, id: number) => remove(db, actor, 'acceptance', id)

export function addComment(db: DB, actor: Actor, issueId: number, body: string) {
  return insert(db, actor, 'comments', { issue_id: issueId, actor, body_md: body, created_at: now() })
}

/** 项目里用过的标签（新建 / 筛选时给候选）。 */
export function projectLabels(db: DB, projectId: number): string[] {
  return (db.prepare("SELECT DISTINCT j.value AS v FROM soloyard_issues i, json_each(i.labels) j WHERE i.project_id = ? ORDER BY v").all(projectId) as Row[]).map((r) => r.v)
}

// ───────────── 会话关联（会话上下文）─────────────

/** 会话能关联的种类。folder / file 的 target 是绝对路径，其余是对应表的 id。 */
export const LINK_KINDS = ['folder', 'file', 'issue', 'document', 'feature', 'decision'] as const

/** 关联对象的显示信息（code + title）；对象已删掉时查不到。 */
const LINK_LABEL: Record<string, string> = {
  issue: "SELECT p.key || '-' || i.number AS code, i.title, i.status FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id WHERE i.id = ?",
  document: 'SELECT NULL AS code, title FROM soloyard_documents WHERE id = ?',
  feature: 'SELECT code, name AS title FROM soloyard_features WHERE id = ?',
  decision: 'SELECT code, title FROM soloyard_decisions WHERE id = ?',
}

export function linkSession(db: DB, sessionId: string, kind: string, target: string) {
  if (!(LINK_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown link kind: ${kind}`)
  db.prepare('INSERT OR IGNORE INTO soloyard_session_links (session_id, kind, target, created_at) VALUES (?, ?, ?, ?)').run(sessionId, kind, target, now())
}
export function unlinkSession(db: DB, sessionId: string, kind: string, target: string) {
  db.prepare('DELETE FROM soloyard_session_links WHERE session_id = ? AND kind = ? AND target = ?').run(sessionId, kind, target)
}
/** 会话的关联，带上显示用的 code / title 和输入框里 @ 引用用的 mention；对象被删了的标 missing。 */
export function sessionLinks(db: DB, sessionId: string): Row[] {
  const rows = db.prepare('SELECT kind, target, created_at FROM soloyard_session_links WHERE session_id = ? ORDER BY created_at, rowid').all(sessionId) as Row[]
  return rows.map((l) => {
    let row: Row
    if (l.kind === 'folder' || l.kind === 'file') row = { ...l, code: null, title: basename(l.target) || l.target }
    else {
      const hit = LINK_LABEL[l.kind] && (db.prepare(LINK_LABEL[l.kind]).get(Number(l.target)) as Row | undefined)
      row = hit ? { ...l, ...hit } : { ...l, code: null, title: l.target, missing: true }
    }
    return { ...row, mention: mentionOf(row) }
  })
}

/**
 * 输入框里引用关联的写法：@link/SOL-5、@link/D-1、@link/doc-2、@link/<文件夹名>。
 * ponytail: 同名文件夹 / 文件会撞名，@ 一次两个都带上；真成问题再加序号。
 */
function mentionOf(l: Row): string {
  const name = l.code ?? (l.kind === 'document' ? `doc-${l.target}` : l.title)
  return `link/${String(name).replace(/\s+/g, '-')}`
}

/** 文字里 @ 到的 mention：@ 前面是开头、空白或标点（email@link 不算），去掉紧跟的标点。 */
function mentionsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/(?:^|[\s，。；：！？、（(])@(link\/[^\s@，。；：！？、）]+)/g)].map((m) => m[1].replace(/[.,;:!?)]+$/, '')))
}

/** 添加关联时的候选：项目里某一类对象，按 code / 标题搜，最多 50 条。 */
export function linkCandidates(db: DB, projectId: number, kind: string, q = ''): Row[] {
  const like = `%${q.trim()}%`
  const sql: Record<string, string> = {
    issue: `SELECT i.id, p.key || '-' || i.number AS code, i.title, i.status FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id
      WHERE i.project_id = ? AND (i.title LIKE ? OR p.key || '-' || i.number LIKE ?) ORDER BY i.status IN ('done','canceled'), i.number DESC`,
    document: 'SELECT id, NULL AS code, title FROM soloyard_documents WHERE project_id = ? AND (title LIKE ? OR slug LIKE ?) ORDER BY updated_at DESC',
    feature: 'SELECT id, code, name AS title FROM soloyard_features WHERE project_id = ? AND (name LIKE ? OR code LIKE ?) ORDER BY code',
    decision: 'SELECT id, code, title FROM soloyard_decisions WHERE project_id = ? AND (title LIKE ? OR code LIKE ?) ORDER BY id',
  }
  if (!sql[kind]) return []
  return db.prepare(`${sql[kind]} LIMIT 50`).all(projectId, like, like) as Row[]
}

/** 文档正文：有 markdown 用 markdown，否则把结构化块里的文字按顺序摊平。 */
function documentText(doc: Row): string {
  if (doc.body_md?.trim()) return doc.body_md.trim()
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.trim()) out.push(v.trim()) }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'type' && k !== 'id' && k !== 'tone' && walk(x))
  }
  try { walk(JSON.parse(doc.blocks_json ?? 'null')) } catch { /* 坏 JSON 当空文档 */ }
  return out.join('\n')
}

// ponytail: 单篇文档截到 2 万字，再长就该给 agent 一个按需读文档的 MCP 工具
const DOC_LIMIT = 20_000
const clip = (text: string) => (text.length > DOC_LIMIT ? `${text.slice(0, DOC_LIMIT)}\n…(truncated)` : text)

/** 一个关联对象发给 agent 的内容；对象没了返回 null。 */
function linkContext(db: DB, kind: string, target: string): string | null {
  if (kind === 'folder') return `Linked folder (readable and writable in addition to the working directory): ${target}`
  if (kind === 'file') return `Linked file (read it when relevant): ${target}`
  if (kind === 'issue') {
    const issue = getIssue(db, Number(target))
    if (!issue) return null
    const acc = issue.acceptance.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}`).join('\n')
    return [`Issue ${issue.ident}: ${issue.title}`, issue.body_md?.trim(), acc && `Acceptance criteria:\n${acc}`].filter(Boolean).join('\n\n')
  }
  if (kind === 'document') {
    const doc = getRow(db, 'documents', Number(target))
    return doc ? `Document "${doc.title}":\n\n${clip(documentText(doc))}` : null
  }
  if (kind === 'feature') {
    const f = getRow(db, 'features', Number(target))
    return f ? `Feature ${f.code}: ${f.name} (${[f.backbone, f.module, f.layer, f.level, f.tier, f.choice].filter(Boolean).join(' / ')})` : null
  }
  if (kind === 'decision') {
    const d = getRow(db, 'decisions', Number(target))
    if (!d) return null
    const data = JSON.parse(d.data_json || '{}')
    const pick = data.user?.option ?? data.ai?.option
    const label = data.options?.find((o: Row) => o.key === pick)?.label
    const lines = [`Decision ${d.code}: ${d.title} (${d.status})`]
    if (label) lines.push(`Chosen: ${pick}. ${label}`)
    if (data.user?.note) lines.push(`Note: ${data.user.note}`)
    return lines.join('\n')
  }
  return null
}

/**
 * 发送前调用：按需注入——只把消息里 @ 到的关联对象的内容带给 agent（text），
 * 再加上额外关联且还在的文件夹（dirs），交给 Claude 的 --add-dir / Codex 的可写目录。
 */
export function sessionContext(db: DB, sessionId: string, message = ''): { dirs: string[]; text: string } {
  const links = sessionLinks(db, sessionId)
  const dirs = links.filter((l) => l.kind === 'folder' && existsSync(l.target)).map((l) => l.target as string) // 删掉的目录交给 --add-dir 会让 CLI 报错
  const wanted = mentionsIn(message)
  const parts = links
    .filter((l) => wanted.has(l.mention))
    .map((l) => linkContext(db, l.kind, l.target))
    .filter((part): part is string => !!part)
  return { dirs, text: parts.join('\n\n---\n\n') }
}
