/**
 * 决策和证据（docs/soloyard/project-workflow.md「流程」第 6 步）：以库为准，product-thinking 的 decisions.json / evidence.json 只是工作副本。
 * - agent 写决策的选项、证据、推荐、反方（upsertDecisions），不能替用户拍板；
 * - 用户在 Decisions 页拍板（decide，via = 应用），或在对话里说了、agent 代为记下（via = 对话，必须带用户原话）；
 * - 双向门可以一键采纳 AI 建议（adoptTwoWay）；单向门必须逐项选。
 * 字段照 product-thinking 的 SCHEMA（context、evidence、options、ai、counter、user……），除 code / title / door / status 外都放 data_json。
 */
import { randomUUID } from 'node:crypto'
import type { DB } from './db.ts'
import { tx } from './db.ts'
import { insert, update, type Actor, type Row } from './repo.ts'

export type Option = { key: string; label: string; benefit?: string; cost?: string; reversibility?: string }
export type UserDecision = { option: string; note?: string; date: string; via: '应用' | '对话'; by: Actor; quote?: string }
export type Decision = {
  id: number; code: string; title: string; door: string | null; status: string; updated_at: string; version: number
  context?: string; evidence?: string[]; options?: Option[]; ai?: { option?: string; reason?: string; level?: string }
  counter?: string; needs_info?: string; user?: UserDecision | null; aliases?: string[]; [k: string]: unknown
}

const parse = (r: Row): Decision => ({ ...JSON.parse(r.data_json || '{}'), id: r.id, code: r.code, title: r.title, door: r.door, status: r.status, updated_at: r.updated_at, version: r.version })

/** 单向门在前、没定的在前，其余按编号。 */
export function listDecisions(db: DB, projectId: number): Decision[] {
  const rank = (d: Decision) => (d.status === 'decided' ? 2 : 0) + (d.door === 'one-way' ? 0 : 1)
  return (db.prepare('SELECT * FROM soloyard_decisions WHERE project_id = ?').all(projectId) as Row[])
    .map(parse)
    .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** 按编号或别名找。 */
export function getDecision(db: DB, projectId: number, code: string): Decision | undefined {
  return listDecisions(db, projectId).find((d) => d.code === code || d.aliases?.includes(code))
}

const mustDecision = (db: DB, projectId: number, code: string) => {
  const d = getDecision(db, projectId, code)
  if (!d) throw new Error(`找不到决策 ${code}`)
  return d
}

export type DecisionInput = Omit<Partial<Decision>, 'id' | 'status' | 'user' | 'updated_at' | 'version'> & { code: string; title?: string }

/** agent 写决策（新建或补充）。不碰用户的决定：已拍板的只更新说明，状态和 user 原样保留。 */
export function upsertDecisions(db: DB, actor: Actor, projectId: number, items: DecisionInput[]) {
  return tx(db, () => items.map((item) => {
    const { code, title, door, ...rest } = item
    if (!code) throw new Error('决策要有编号（code，比如 D-3）')
    const prev = getDecision(db, projectId, code)
    if (!prev) {
      if (!title) throw new Error(`新决策 ${code} 要有标题`)
      insert(db, actor, 'decisions', { project_id: projectId, code, title, door: door ?? null, status: 'pending', data_json: JSON.stringify({ ...rest, user: null }) })
    } else {
      const { id: _i, code: _c, title: oldTitle, door: oldDoor, status, updated_at: _u, version: _v, ...data } = prev
      update(db, actor, 'decisions', prev.id, { title: title ?? oldTitle, door: door ?? oldDoor, status, data_json: JSON.stringify({ ...data, ...rest, user: prev.user ?? null }) })
    }
    return getDecision(db, projectId, code)!
  }))
}

/** 拍板（或改主意，变更历史里留着上一次）。via = 对话 时必须带用户原话。 */
export function decide(db: DB, actor: Actor, projectId: number, code: string, input: { option: string; note?: string; via: '应用' | '对话'; quote?: string }, batch?: string) {
  const d = mustDecision(db, projectId, code)
  if (d.options?.length && !d.options.some((o) => o.key === input.option)) throw new Error(`${d.code} 没有选项 ${input.option}，可选：${d.options.map((o) => o.key).join(', ')}`)
  if (input.via === '对话' && !input.quote?.trim()) throw new Error('代用户记决定要附上用户的原话（quote）')
  const { id, code: _c, title, door, status: _s, updated_at: _u, version: _v, ...data } = d
  const user: UserDecision = { option: input.option, note: input.note?.trim() || undefined, date: new Date().toISOString(), via: input.via, by: actor, quote: input.quote?.trim() || undefined }
  update(db, actor, 'decisions', id, { title, door, status: 'decided', data_json: JSON.stringify({ ...data, user }) }, undefined, batch)
  return getDecision(db, projectId, code)!
}

/** 双向门一键采纳 AI 建议：没定、有 AI 推荐的双向门都按推荐拍板。返回 batch（界面整批撤销）。 */
export function adoptTwoWay(db: DB, actor: Actor, projectId: number) {
  const batch = `adopt-two-way:${randomUUID()}`
  const adopted = tx(db, () => listDecisions(db, projectId)
    .filter((d) => d.status !== 'decided' && d.door !== 'one-way' && d.ai?.option)
    .map((d) => decide(db, actor, projectId, d.code, { option: d.ai!.option!, note: '采纳 AI 建议', via: '应用' }, batch).code))
  return { batch, adopted }
}

// ───────────── 证据 ─────────────

export type Evidence = { id: number; code: string; level: string | null; verified: string | null; claim?: string; quote?: string; url?: string; platform?: string; accessed?: string; [k: string]: unknown }

export function listEvidence(db: DB, projectId: number, filter: { codes?: string[]; q?: string } = {}): Evidence[] {
  const q = filter.q?.trim().toLowerCase()
  return (db.prepare('SELECT * FROM soloyard_evidence WHERE project_id = ?').all(projectId) as Row[])
    .map((r) => ({ ...JSON.parse(r.data_json || '{}'), id: r.id, code: r.code, level: r.level, verified: r.verified }) as Evidence)
    .filter((e) => !filter.codes?.length || filter.codes.includes(e.code))
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** agent 记证据：没给编号的按 E-<下一个数字> 编；编号已有的更新。返回编号。 */
export function addEvidence(db: DB, actor: Actor, projectId: number, items: (Partial<Evidence> & { claim: string })[]) {
  return tx(db, () => {
    const used = (db.prepare('SELECT code FROM soloyard_evidence WHERE project_id = ?').all(projectId) as Row[]).map((r) => String(r.code))
    let next = Math.max(0, ...used.map((c) => Number(/^E-(\d+)$/.exec(c)?.[1] ?? 0))) + 1
    return items.map(({ id: _id, code, level, verified, ...data }) => {
      const c = code ?? `E-${next++}`
      const prev = db.prepare('SELECT id FROM soloyard_evidence WHERE project_id = ? AND code = ?').get(projectId, c) as Row | undefined
      const row = { level: level ?? null, verified: verified ?? '未回查', data_json: JSON.stringify(data) }
      // 证据表没有版本列：已有的直接改，新的照常 insert（记进变更历史）
      if (prev) db.prepare('UPDATE soloyard_evidence SET level = ?, verified = ?, data_json = ? WHERE id = ?').run(row.level, row.verified, row.data_json, prev.id)
      else insert(db, actor, 'evidence', { project_id: projectId, code: c, ...row })
      return c
    })
  })
}
