import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import { tx } from './db.ts'
import { BUCKETS, type Bucket, type Target } from './iterations.ts'
import { getRow, insert, update, type Actor, type Row } from './repo.ts'

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const norm = (tag: string) => String(tag).trim().toLowerCase().replace(/^v/, '')
const isBucket = (t: unknown): t is Bucket => BUCKETS.includes(t as Bucket)
/** 功能行里有自己列的字段；其余整行存进 data_json。 */
const FEATURE_COLS = ['id', 'backbone', 'module', 'name', 'layer', 'level', 'tier', 'plan']

/**
 * 导入一个 product-thinking 项目目录：立项卡等文档、证据、决策、功能全景和 AI 的版本表。按编号覆盖，重复导入安全：
 * - 版本表（features.json 的 iterations）里没有的版本号才新建，已有的迭代不动（名称、目标可能被用户改过）。
 *   导入过、后来在应用里不见了的版本号（用户删了或改了名）不再重建：导入过的版本号记在项目 meta_json.imported_tags。
 * - 功能按 plan 放进迭代 / 待定 / 另立项 / 不做。已有的功能只在用户没挪过时（还在 AI 上次的安排里）才跟着新安排走，
 *   用户挪过的保留；已完成（锁定）的迭代进出都不动。ai_plan 总是更新成这次的安排。
 * - 决策：文件里没有用户决定时，保留应用里已有的（重复导入不能冲掉用户在应用里做的决定）。
 * 一次事务，任何一步失败都不留半截。
 */
export function importProductThinking(db: DB, actor: Actor, dir: string, projectId: number) {
  const project = readJson(join(dir, 'project.json'))
  if (!project) throw new Error(`不是 product-thinking 目录：${dir} 下没有 project.json`)
  if (!getRow(db, 'projects', projectId)) throw new Error(`project ${projectId} not found`)
  const batch = `import-pt:${Date.now()}`
  return tx(db, () => {
    const p = getRow(db, 'projects', projectId)!
    if (!p.goal && project.idea) update(db, actor, 'projects', projectId, { goal: project.idea }, undefined, batch)

    // 文档（节 + 块）
    let docs = 0
    const docDir = join(dir, 'docs')
    for (const f of existsSync(docDir) ? readdirSync(docDir).filter((f) => f.endsWith('.json')).sort() : []) {
      const d = readJson(join(docDir, f))
      const kind = d.id?.startsWith('01') ? 'brief' : d.id?.startsWith('02') ? 'features' : 'free'
      const row = { kind, title: d.title ?? d.id, blocks_json: JSON.stringify({ meta: d.meta, lead: d.lead, sections: d.sections }) }
      const hit = db.prepare('SELECT id FROM soloyard_documents WHERE project_id = ? AND slug = ?').get(projectId, d.id) as Row | undefined
      if (hit) update(db, actor, 'documents', hit.id, row, undefined, batch)
      else insert(db, actor, 'documents', { project_id: projectId, slug: d.id, body_md: '', ...row }, batch)
      docs++
    }

    // 证据：量大且只读，不进变更日志
    const ev = readJson(join(dir, 'evidence.json'))
    const upsertEvidence = db.prepare(`INSERT INTO soloyard_evidence (project_id, code, level, verified, data_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, code) DO UPDATE SET level = excluded.level, verified = excluded.verified, data_json = excluded.data_json`)
    for (const { id, level, verified, ...rest } of ev?.items ?? []) upsertEvidence.run(projectId, id, level ?? null, verified ?? null, JSON.stringify(rest))

    // 决策
    const de = readJson(join(dir, 'decisions.json'))
    for (const { id: code, title, door, status, user, ...rest } of de?.decisions ?? []) {
      const prev = db.prepare('SELECT id, data_json FROM soloyard_decisions WHERE project_id = ? AND code = ?').get(projectId, code) as Row | undefined
      const keepUser = user ?? (prev ? JSON.parse(prev.data_json).user : null) ?? null
      const row = { title, door: door ?? null, status: keepUser ? 'decided' : status ?? 'pending', data_json: JSON.stringify({ ...rest, user: keepUser }) }
      if (prev) update(db, actor, 'decisions', prev.id, row, undefined, batch)
      else insert(db, actor, 'decisions', { project_id: projectId, code, ...row }, batch)
    }

    // 版本表：没有的版本号按文件里的顺序接在已有迭代后面
    const fe = readJson(join(dir, 'features.json'))
    const meta = p.meta_json ? JSON.parse(p.meta_json) : {}
    const imported = new Set<string>(meta.imported_tags ?? [])
    const existing = () => db.prepare('SELECT * FROM soloyard_iterations WHERE project_id = ? ORDER BY sort, id').all(projectId) as Row[]
    let created = 0
    for (const it of fe?.iterations ?? []) {
      if (!it.tag || existing().some((x) => norm(x.tag) === norm(it.tag)) || imported.has(norm(it.tag))) continue
      const sort = (existing().at(-1)?.sort ?? 0) + 1
      insert(db, actor, 'iterations', { project_id: projectId, tag: String(it.tag).trim(), name: it.name ?? '', goal: it.goal ?? '', target_date: it.target_date ?? null, status: 'planned', sort }, batch)
      created++
    }
    const iterations = existing()
    const resolve = (plan: string | null | undefined): Target | null => {
      if (plan == null) return null
      if (isBucket(plan)) return plan
      return iterations.find((i) => norm(i.tag) === norm(plan))?.id ?? null
    }
    const locked = (t: Target | null) => typeof t === 'number' && iterations.find((i) => i.id === t)?.status === 'done'
    const placement = (t: Target) => (isBucket(t) ? { iteration_id: null, bucket: t } : { iteration_id: t, bucket: 'pending' })

    // 功能
    let features = 0, placed = 0, kept = 0
    for (const r of fe?.rows ?? []) {
      const code = r.id ?? r.code
      const cols = { backbone: r.backbone ?? null, module: r.module ?? null, name: r.name, layer: r.layer ?? null, level: r.level ?? null, tier: r.tier ?? null }
      const data_json = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !FEATURE_COLS.includes(k))))
      const plan: string | null = r.plan ?? null
      const target = resolve(plan) ?? (plan ? 'pending' : null) // 版本号对不上（文件里没定义）就先放待定
      const hit = db.prepare('SELECT * FROM soloyard_features WHERE project_id = ? AND code = ?').get(projectId, code) as Row | undefined
      if (!hit) {
        insert(db, actor, 'features', { project_id: projectId, code, ...cols, data_json, ai_plan: plan, sort: features, ...(target != null ? placement(target) : {}) }, batch)
        if (target != null) placed++
      } else {
        const current: Target = hit.iteration_id ?? hit.bucket
        const untouched = hit.ai_plan == null ? current === 'pending' : resolve(hit.ai_plan) === current
        const move = target != null && target !== current && untouched && !locked(current) && !locked(target)
        update(db, actor, 'features', hit.id, { ...cols, data_json, ai_plan: plan ?? hit.ai_plan, ...(move ? placement(target) : {}) }, undefined, batch)
        if (move) placed++
        else if (target != null && target !== current) kept++
      }
      features++
    }

    // 骨干名称、竞品全名、导入过的版本号进项目 meta
    for (const it of fe?.iterations ?? []) if (it.tag) imported.add(norm(it.tag))
    const backbones = Object.fromEntries((fe?.backbone ?? []).map((b: Row) => [b.id, b.name]))
    update(db, actor, 'projects', projectId, {
      meta_json: JSON.stringify({
        ...meta, imported_tags: [...imported],
        ...(Object.keys(backbones).length ? { backbones } : {}), ...(fe?.meta?.products ? { products: fe.meta.products } : {}),
      }),
    }, undefined, batch)

    return { docs, evidence: ev?.items?.length ?? 0, decisions: de?.decisions?.length ?? 0, features, iterations_created: created, placed, kept_user_moves: kept }
  })
}
