/**
 * 项目阶段（docs/soloyard/project-workflow.md「阶段」）：
 * 想法 idea → 立项 initiating → 建造 building → 上线 launched，另有终止态 搁置 parked / 放弃 killed。
 * - 想法 → 立项只经「提升为项目」（promoteIdea），不给手动改；立项 → 建造不存，有迭代开始过就算建造。
 * - 手动只能标：搁置、放弃（要写原因）、上线（从建造），以及从搁置恢复。原因和搁置前的阶段记在 meta_json.stage_note。
 * - 立项期的小步（step）从数据推出来，不存：待立项 → 待拍板 → 待排版本 → 待减法。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import { getRow, update, type Actor, type Row } from './repo.ts'

export const STAGES = ['idea', 'initiating', 'building', 'launched', 'parked', 'killed'] as const
export type Stage = (typeof STAGES)[number]
/** 立项期的小步：还没有立项卡 / 有单向门没定 / 还没有迭代 / 有迭代但一个都没开始。 */
export type InitStep = 'charter' | 'decide' | 'versions' | 'cut'
/** 下一步：要 agent 干活的给提示词（界面填进输入框），要用户自己做的给视图。 */
export type NextStep = { key: string; view?: string; prompt?: boolean }
export type StageNote = { reason?: string; from?: Stage; at: string; by: Actor }
export type StageInfo = { stage: Stage; step?: InitStep; next?: NextStep; note?: StageNote }

const meta = (p: Row) => (p.meta_json ? JSON.parse(p.meta_json) : {}) as { stage_note?: StageNote }

/** 项目根目录（关联目录里最短的那个），没有就 undefined。 */
export function projectRoot(db: DB, projectId: number): string | undefined {
  return (db.prepare('SELECT path FROM soloyard_project_paths WHERE project_id = ? ORDER BY length(path) LIMIT 1').get(projectId) as { path?: string } | undefined)?.path
}

/** 立项卡在不在：docs/product/ 里（文档规范）或 docs/ 根下（之前的写法）文件名带「立项」，旧数据看文档表的 slug。 */
function hasCharter(db: DB, projectId: number) {
  const root = projectRoot(db, projectId)
  for (const dir of root ? [join(root, 'docs', 'product'), join(root, 'docs')] : []) {
    if (existsSync(dir) && readdirSync(dir).some((f) => /立项|charter/i.test(f))) return true
  }
  return !!db.prepare("SELECT 1 FROM soloyard_documents WHERE project_id = ? AND (slug LIKE '01-%' OR title LIKE '%立项%')").get(projectId)
}

const NEXT: Record<string, NextStep> = {
  idea: { key: 'idea' },
  charter: { key: 'charter', prompt: true },
  decide: { key: 'decide', view: 'decisions' },
  versions: { key: 'versions', prompt: true },
  cut: { key: 'cut', view: 'cycles' },
  building: { key: 'building', view: 'issues' },
}

/** 项目现在在哪个阶段、立项期在哪一小步、下一步做什么。 */
export function projectStage(db: DB, projectId: number): StageInfo {
  const p = getRow(db, 'projects', projectId)
  if (!p) throw new Error(`找不到项目 ${projectId}`)
  const note = meta(p).stage_note
  const stored = (STAGES as readonly string[]).includes(p.stage) ? (p.stage as Stage) : 'building'
  const iterations = db.prepare('SELECT status FROM soloyard_iterations WHERE project_id = ?').all(projectId) as Row[]
  const started = iterations.some((i) => i.status !== 'planned')
  if (stored === 'idea') return { stage: 'idea', next: NEXT.idea }
  if (stored === 'parked' || stored === 'killed') return { stage: stored, note }
  if (stored === 'launched') return { stage: 'launched', note }
  if (stored === 'building' || started) return { stage: 'building', next: NEXT.building }
  const step: InitStep = !hasCharter(db, projectId)
    ? 'charter'
    : db.prepare("SELECT 1 FROM soloyard_decisions WHERE project_id = ? AND door = 'one-way' AND status != 'decided'").get(projectId)
      ? 'decide'
      : !iterations.length ? 'versions' : 'cut'
  return { stage: 'initiating', step, next: NEXT[step] }
}

export type StageChange = 'parked' | 'killed' | 'launched' | 'resume'

/** 手动改阶段：搁置、放弃（要原因）、上线（只能从建造）、从搁置恢复。想法 → 立项走 promoteIdea。 */
export function setProjectStage(db: DB, actor: Actor, projectId: number, to: StageChange, reason?: string) {
  const p = getRow(db, 'projects', projectId)
  if (!p) throw new Error(`找不到项目 ${projectId}`)
  const now = projectStage(db, projectId).stage
  const m = meta(p)
  const note = (from: Stage): StageNote => ({ reason: reason?.trim() || undefined, from, at: new Date().toISOString(), by: actor })
  let stage: Stage
  if (to === 'resume') {
    if (now !== 'parked' && now !== 'killed') throw new Error('只有搁置或放弃的项目才能恢复')
    stage = m.stage_note?.from ?? 'building'
    delete m.stage_note
  } else {
    if (to === 'killed' && !reason?.trim()) throw new Error('放弃项目要写原因')
    if (to === 'launched' && now !== 'building') throw new Error('建造期的项目才能标上线')
    if ((to === 'parked' || to === 'killed') && (now === 'parked' || now === 'killed')) throw new Error('项目已经搁置或放弃了，先恢复')
    stage = to
    m.stage_note = note(now)
  }
  return update(db, actor, 'projects', projectId, { stage, meta_json: JSON.stringify(m) })
}
