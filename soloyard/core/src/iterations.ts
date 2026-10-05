import { randomUUID } from 'node:crypto'
import type { DB } from './db.ts'
import { tx } from './db.ts'
import { createIssue, getRow, insert, remove, revertChange, update, type Actor, type Row } from './repo.ts'

/**
 * 迭代：一张带版本号的规划表。每个功能要么在某个迭代里，要么在 bucket（待定 / 另立项 / 不做）。
 * 迭代按 sort 排，先后就是优先级。迭代默认不建 issue，「开始」时给勾选的功能各建一个（一个功能一个 issue），
 * issue 跟着功能走：功能被挪到别的迭代，issue 的 iteration_id 一起改。
 * 已完成的迭代锁定，功能不能挪进挪出，重新打开才解锁。
 * 多步操作（删除、开始、完成、生成）共用一个 batch，界面的「撤销」按 batch 整批回滚。
 */

export type Bucket = 'pending' | 'split' | 'cut'
/** 功能的去处：迭代 id，或一个 bucket。 */
export type Target = number | Bucket
export const BUCKETS: Bucket[] = ['pending', 'split', 'cut']

const now = () => new Date().toISOString()
const newBatch = (kind: string) => `${kind}:${randomUUID()}`
const isBucket = (t: unknown): t is Bucket => BUCKETS.includes(t as Bucket)

/** 版本号查重：忽略大小写和前缀 v（v1.0 和 1.0 算同一个）。 */
const norm = (tag: string) => tag.trim().toLowerCase().replace(/^v/, '')

function iterationsOf(db: DB, projectId: number): Row[] {
  return db.prepare('SELECT * FROM soloyard_iterations WHERE project_id = ? ORDER BY sort, id').all(projectId) as Row[]
}

function mustIteration(db: DB, id: number): Row {
  const it = getRow(db, 'iterations', id)
  if (!it) throw new Error(`找不到迭代 ${id}`)
  return it
}

function checkTag(db: DB, projectId: number, tag: string, exceptId?: number) {
  if (!tag.trim()) throw new Error('版本号不能为空')
  const clash = iterationsOf(db, projectId).find((i) => i.id !== exceptId && norm(i.tag) === norm(tag))
  if (clash) throw new Error(`版本号 ${tag.trim()} 已经有了`)
}

/** 插在 beforeId 前面（null = 排最后）：取前后两个的中间值，不用整体重排。 */
function sortBefore(db: DB, projectId: number, beforeId: number | null, exceptId?: number): number {
  const list = iterationsOf(db, projectId).filter((i) => i.id !== exceptId)
  const at = beforeId == null ? -1 : list.findIndex((i) => i.id === beforeId)
  if (at < 0) return (list.at(-1)?.sort ?? 0) + 1
  const prev = list[at - 1]?.sort ?? list[at].sort - 1
  return (prev + list[at].sort) / 2
}

/** 去处校验：迭代要存在、属于这个项目、没有完成（锁定）。 */
function checkTarget(db: DB, projectId: number, target: Target) {
  if (isBucket(target)) return
  const it = getRow(db, 'iterations', Number(target))
  if (!it || it.project_id !== projectId) throw new Error(`找不到迭代 ${target}`)
  if (it.status === 'done') throw new Error(`${it.tag} 已完成并锁定，重新打开后才能往里放功能`)
}

/** 功能当前的 issue：一个功能一个 issue，取最新的那个。 */
function featureIssue(db: DB, featureId: number): Row | undefined {
  return db.prepare('SELECT * FROM soloyard_issues WHERE feature_id = ? ORDER BY id DESC LIMIT 1').get(featureId) as Row | undefined
}

/** 挪一个功能（连同它的 issue）。调用方负责锁定和去处校验。 */
function place(db: DB, actor: Actor, feature: Row, target: Target, batch?: string) {
  const patch = isBucket(target) ? { iteration_id: null, bucket: target } : { iteration_id: Number(target), bucket: 'pending' }
  update(db, actor, 'features', feature.id, patch, undefined, batch)
  const issue = featureIssue(db, feature.id)
  if (issue) update(db, actor, 'issues', issue.id, { iteration_id: patch.iteration_id }, undefined, batch)
}

const unfinished = (issue: Row | undefined) => !issue || !['done', 'canceled'].includes(issue.status)

// ───────────── 读 ─────────────

/**
 * 迭代页一次要的全部数据。功能的详细调研字段只取界面用到的几项（data_json 整体很大，几百个功能会拖慢刷新）。
 */
export function iterationPlan(db: DB, projectId: number) {
  const project = getRow(db, 'projects', projectId)
  if (!project) throw new Error(`project ${projectId} not found`)
  const features = db.prepare(`
    SELECT f.id, f.code, f.backbone, f.name, f.level, f.tier, f.iteration_id, f.bucket, f.ai_plan, f.sort,
      json_extract(f.data_json, '$.reason') AS reason, json_extract(f.data_json, '$.job') AS job,
      json_extract(f.data_json, '$.kano') AS kano, json_extract(f.data_json, '$.evidence') AS evidence,
      json_extract(f.data_json, '$.prevalence.direct') AS prevalence,
      i.id AS issue_id, p.key || '-' || i.number AS issue_ident, i.status AS issue_status
    FROM soloyard_features f JOIN soloyard_projects p ON p.id = f.project_id
    LEFT JOIN soloyard_issues i ON i.id = (SELECT MAX(id) FROM soloyard_issues WHERE feature_id = f.id)
    WHERE f.project_id = ? ORDER BY f.sort, f.code`).all(projectId) as Row[]
  const meta = project.meta_json ? JSON.parse(project.meta_json) : {}
  return {
    iterations: iterationsOf(db, projectId).map((it) => ({ ...it, summary: it.summary_json ? JSON.parse(it.summary_json) : null })),
    features: features.map((f) => ({ ...f, evidence: f.evidence ? (JSON.parse(f.evidence) as string[]) : [] })),
    /** 骨干编号 → 名称（导入功能全景时写进项目 meta_json.backbones）。 */
    backbones: (meta.backbones ?? {}) as Record<string, string>,
  }
}

// ───────────── 迭代 ─────────────

export type IterationInput = { tag: string; name?: string; goal?: string; target_date?: string | null }

export function createIteration(db: DB, actor: Actor, projectId: number, input: IterationInput, beforeId: number | null = null) {
  return tx(db, () => {
    checkTag(db, projectId, input.tag)
    return insert(db, actor, 'iterations', {
      project_id: projectId, tag: input.tag.trim(), name: input.name?.trim() ?? '', goal: input.goal?.trim() ?? '',
      target_date: input.target_date || null, status: 'planned', sort: sortBefore(db, projectId, beforeId),
    })
  })
}

export function updateIteration(db: DB, actor: Actor, id: number, patch: Partial<IterationInput>) {
  return tx(db, () => {
    const it = mustIteration(db, id)
    const p: Row = {}
    if (patch.tag !== undefined) { checkTag(db, it.project_id, patch.tag, id); p.tag = patch.tag.trim() }
    if (patch.name !== undefined) p.name = patch.name.trim()
    if (patch.goal !== undefined) p.goal = patch.goal.trim()
    if (patch.target_date !== undefined) p.target_date = patch.target_date || null
    return update(db, actor, 'iterations', id, p)
  })
}

/** 调整先后（= 优先级）：放到 beforeId 前面，null = 放最后。 */
export function moveIteration(db: DB, actor: Actor, id: number, beforeId: number | null) {
  return tx(db, () => {
    const it = mustIteration(db, id)
    return update(db, actor, 'iterations', id, { sort: sortBefore(db, it.project_id, beforeId, id) })
  })
}

/** 删除迭代：里面的功能（连同 issue）和直接挂在它上面的 issue 挪到 moveTo。返回 batch，给撤销用。 */
export function deleteIteration(db: DB, actor: Actor, id: number, moveTo: Target) {
  const batch = newBatch('delete-iteration')
  tx(db, () => {
    const it = mustIteration(db, id)
    if (moveTo === id) throw new Error('不能挪到要删除的迭代自己')
    checkTarget(db, it.project_id, moveTo)
    const features = db.prepare('SELECT * FROM soloyard_features WHERE iteration_id = ?').all(id) as Row[]
    for (const f of features) place(db, actor, f, moveTo, batch)
    const loose = db.prepare('SELECT id FROM soloyard_issues WHERE iteration_id = ?').all(id) as Row[]
    for (const i of loose) update(db, actor, 'issues', i.id, { iteration_id: isBucket(moveTo) ? null : moveTo }, undefined, batch)
    remove(db, actor, 'iterations', id, batch)
  })
  return batch
}

/** 开始迭代：给勾选的功能各建一个 issue（已经有的不重复建），状态改成进行中。 */
export function startIteration(db: DB, actor: Actor, id: number, featureIds: number[]) {
  const batch = newBatch('start-iteration')
  tx(db, () => {
    const it = mustIteration(db, id)
    if (it.status !== 'planned') throw new Error(`${it.tag} 已经开始过了`)
    for (const fid of featureIds) {
      const f = getRow(db, 'features', fid)
      if (!f || f.iteration_id !== id || featureIssue(db, fid)) continue
      createIssue(db, actor, it.project_id, issueFromFeature(f, id), batch)
    }
    update(db, actor, 'iterations', id, { status: 'active', started_at: now() }, undefined, batch)
  })
  return batch
}

/** 完成迭代：没做完的功能按 moves 挪走，冻结「完成 N · 移出 M」，迭代锁定。moves 里没列到的未完成功能留在原迭代。 */
export function finishIteration(db: DB, actor: Actor, id: number, moves: Record<string, Target>) {
  const batch = newBatch('finish-iteration')
  tx(db, () => {
    const it = mustIteration(db, id)
    if (it.status !== 'active') throw new Error(`${it.tag} 不在进行中`)
    const features = db.prepare('SELECT * FROM soloyard_features WHERE iteration_id = ?').all(id) as Row[]
    let moved = 0
    for (const f of features) {
      const target = moves[String(f.id)]
      if (target === undefined) continue
      if (!unfinished(featureIssue(db, f.id))) continue // 已经做完的不挪
      if (target === id) continue
      checkTarget(db, it.project_id, target)
      place(db, actor, f, target, batch)
      moved++
    }
    const summary = { done: features.length - moved, moved }
    update(db, actor, 'iterations', id, { status: 'done', completed_at: now(), summary_json: JSON.stringify(summary) }, undefined, batch)
  })
  return batch
}

/** 重新打开：回到进行中，解除锁定；完成时挪走的功能不会自动回来。 */
export function reopenIteration(db: DB, actor: Actor, id: number) {
  const it = mustIteration(db, id)
  if (it.status !== 'done') throw new Error(`${it.tag} 没有完成`)
  return update(db, actor, 'iterations', id, { status: 'active', completed_at: null, summary_json: null })
}

// ───────────── 功能 ─────────────

function issueFromFeature(f: Row, iterationId: number | null) {
  const data = f.data_json ? JSON.parse(f.data_json) : {}
  const body = [data.reason && `理由：${data.reason}`, data.job && `服务的 job：${data.job}`].filter(Boolean).join('\n')
  return { title: f.name as string, body_md: body, status: 'todo', feature_id: f.id as number, iteration_id: iterationId ?? undefined }
}

/** 减法 / 重新排期：把功能挪到别的迭代或 bucket。已完成的迭代锁定，进出都不行。 */
export function moveFeatures(db: DB, actor: Actor, featureIds: number[], target: Target) {
  return tx(db, () => {
    for (const fid of featureIds) {
      const f = getRow(db, 'features', fid)
      if (!f) throw new Error(`找不到功能 ${fid}`)
      if (f.iteration_id && getRow(db, 'iterations', f.iteration_id)?.status === 'done') throw new Error(`${f.code} 所在的迭代已完成并锁定`)
      checkTarget(db, f.project_id, target)
      place(db, actor, f, target)
    }
  })
}

/** 手动加功能：编号按 F-001 往下排。 */
export function createFeature(db: DB, actor: Actor, projectId: number, input: { name: string; backbone?: string }, target: Target = 'pending') {
  return tx(db, () => {
    if (!input.name.trim()) throw new Error('功能名不能为空')
    checkTarget(db, projectId, target)
    const codes = (db.prepare("SELECT code FROM soloyard_features WHERE project_id = ? AND code LIKE 'F-%'").all(projectId) as Row[])
      .map((r) => Number(String(r.code).slice(2))).filter(Number.isFinite)
    const code = `F-${String(Math.max(0, ...codes) + 1).padStart(3, '0')}`
    return insert(db, actor, 'features', {
      project_id: projectId, code, name: input.name.trim(), backbone: input.backbone ?? null,
      iteration_id: isBucket(target) ? null : target, bucket: isBucket(target) ? target : 'pending', sort: Date.now(),
    })
  })
}

export function renameFeature(db: DB, actor: Actor, id: number, name: string) {
  if (!name.trim()) throw new Error('功能名不能为空')
  return update(db, actor, 'features', id, { name: name.trim() })
}

/** 删除功能：它的 issue 不删，只解除关联（先记一笔，撤销时能连上）。返回 batch。 */
export function deleteFeature(db: DB, actor: Actor, id: number) {
  const batch = newBatch('delete-feature')
  tx(db, () => {
    for (const i of db.prepare('SELECT id FROM soloyard_issues WHERE feature_id = ?').all(id) as Row[]) {
      update(db, actor, 'issues', i.id, { feature_id: null }, undefined, batch)
    }
    remove(db, actor, 'features', id, batch)
  })
  return batch
}

/** 单独给一个功能建 issue（不必开始整个迭代）。 */
export function createFeatureIssue(db: DB, actor: Actor, featureId: number) {
  return tx(db, () => {
    const f = getRow(db, 'features', featureId)
    if (!f) throw new Error(`找不到功能 ${featureId}`)
    const existing = featureIssue(db, featureId)
    if (existing) return existing.id as number
    return createIssue(db, actor, f.project_id, issueFromFeature(f, f.iteration_id))
  })
}

/**
 * 把 issue 收回功能表的「待定」：有功能就挪功能，没有就用 issue 标题建一个功能挂上。
 * 功能不在迭代里时 issue 不进 Issues 列表；以后把功能排进迭代，issue 连同历史一起回来。返回功能 id。
 */
export function parkIssue(db: DB, actor: Actor, issueId: number) {
  return tx(db, () => {
    const issue = getRow(db, 'issues', issueId)
    if (!issue) throw new Error(`找不到 issue ${issueId}`)
    if (issue.feature_id) {
      moveFeatures(db, actor, [issue.feature_id], 'pending')
      return issue.feature_id as number
    }
    const featureId = createFeature(db, actor, issue.project_id, { name: issue.title }, 'pending')
    update(db, actor, 'issues', issueId, { feature_id: featureId, iteration_id: null })
    return featureId
  })
}

/**
 * 还没有迭代时，按功能全景的 AI 分层生成第一版迭代表：骨架 → v0.1，v1 → v1.0，
 * 后续里的必备 / 常见 / 差异化 / 无先例 → v1.1、其余 → v2.0，不建议 → 不做，另立项 → 另立项，没分层 → 待定。
 * 每个功能的 ai_plan 记下这个安排。ponytail: 规则写死；product-thinking 直接产出版本表后改为按它导入。
 */
export function generateIterations(db: DB, actor: Actor, projectId: number) {
  const batch = newBatch('generate-iterations')
  tx(db, () => {
    if (iterationsOf(db, projectId).length) throw new Error('已经有迭代了')
    const plan = [
      { tag: 'v0.1', name: '骨架', goal: '最小可跑通的闭环' },
      { tag: 'v1.0', name: 'MVP', goal: '一个人能用它完成核心工作' },
      { tag: 'v1.1', name: '补齐体验', goal: '竞品都有的常见功能和差异化补齐' },
      { tag: 'v2.0', name: '扩展', goal: '长尾和相邻领域' },
    ]
    const ids = Object.fromEntries(plan.map((p, i) => [p.tag, insert(db, actor, 'iterations', { project_id: projectId, ...p, status: 'planned', sort: i + 1 }, batch)]))
    const core = new Set(['必备', '常见', '差异化', '无先例'])
    for (const f of db.prepare('SELECT * FROM soloyard_features WHERE project_id = ?').all(projectId) as Row[]) {
      const ai: string =
        f.tier === '骨架' ? 'v0.1' : f.tier === 'v1' ? 'v1.0' : f.tier === '后续' ? (core.has(f.level) ? 'v1.1' : 'v2.0')
        : f.tier === '不建议' ? 'cut' : f.tier === '另立项' ? 'split' : 'pending'
      const target: Target = isBucket(ai) ? ai : ids[ai]
      update(db, actor, 'features', f.id, {
        ai_plan: ai, iteration_id: isBucket(target) ? null : target, bucket: isBucket(target) ? target : 'pending',
      }, undefined, batch)
    }
  })
  return batch
}

// ───────────── 撤销 ─────────────

/**
 * 整批撤销（删除迭代、开始、完成、生成……）：按相反顺序回滚这个 batch 的每一笔。
 * 之后有别的修改碰过同一行就拒绝，免得把后来的改动一起撤掉。
 */
export function revertBatch(db: DB, actor: Actor, batch: string) {
  tx(db, () => {
    const changes = db.prepare('SELECT * FROM soloyard_changes WHERE batch = ? ORDER BY id DESC').all(batch) as Row[]
    if (!changes.length) throw new Error('没有可撤销的操作')
    const last = changes[0].id
    const touched = db.prepare(`SELECT 1 FROM soloyard_changes WHERE id > ? AND (entity, entity_id) IN (${changes.map(() => '(?, ?)').join(',')}) LIMIT 1`)
      .get(last, ...changes.flatMap((c) => [c.entity, c.entity_id]))
    if (touched) throw new Error('之后又有修改，不能再撤销这一步了')
    for (const c of changes) revertChange(db, actor, c.id)
  })
}

/** 骨干编号 → 名称，存进项目 meta_json.backbones（导入功能全景时写）。 */
export function setBackbones(db: DB, actor: Actor, projectId: number, backbones: Record<string, string>) {
  const p = getRow(db, 'projects', projectId)
  if (!p) throw new Error(`project ${projectId} not found`)
  const meta = p.meta_json ? JSON.parse(p.meta_json) : {}
  return update(db, actor, 'projects', projectId, { meta_json: JSON.stringify({ ...meta, backbones }) })
}
