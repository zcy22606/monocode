/**
 * 想法项目（docs/soloyard/project-workflow.md 第 1–3 步）：每个头脑风暴就是一条阶段为 idea 的项目，
 * 路径是它的工作文件夹（应用数据目录 workspace/ 下），只在头脑风暴列表里出现。
 * agent 从第一句起经 update_overview 维护标题、英文名、一句话和 overview；用户点「提升为项目」时：
 * 文件夹换成项目文件夹、填上 issue 前缀、阶段改成立项。数据（overview、决策、证据）都挂在同一条项目上，不用搬。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import { tx } from './db.ts'
import { getRow, insert, remove, update, type Actor, type Row } from './repo.ts'
import { SLUG, updateOverview, writeSnapshot } from './overview.ts'

/** issue 前缀：大写字母开头，2–10 位大写字母或数字。 */
export const KEY = /^[A-Z][A-Z0-9]{1,9}$/
const clean = (p: string) => p.replace(/\/+$/, '')

function projectAt(db: DB, path: string): Row | undefined {
  return db.prepare('SELECT p.* FROM soloyard_projects p JOIN soloyard_project_paths pp ON pp.project_id = p.id WHERE pp.path = ?').get(clean(path)) as Row | undefined
}

/** 头脑风暴文件夹对应的想法项目，没有就建：名称先空着（界面显示「未命名想法」），前缀用占位（提升时再定）。 */
export function ideaForPath(db: DB, actor: Actor, path: string): Row {
  return tx(db, () => {
    const hit = projectAt(db, path)
    if (hit) return hit
    const id = insert(db, actor, 'projects', { name: '', goal: '', key: `~${randomUUID().slice(0, 8)}`, stage: 'idea' })
    db.prepare('INSERT INTO soloyard_project_paths (project_id, path, recursive) VALUES (?, ?, 1)').run(id, clean(path))
    return getRow(db, 'projects', id)!
  })
}

export type Idea = { id: number; path: string; name: string; slug: string | null; goal: string; stage: string; note: unknown; updated_at: string }

/** 工作区下的想法项目（包括搁置 / 放弃的），最近更新的在前。 */
export function ideasUnder(db: DB, root: string): Idea[] {
  const base = clean(root) + '/'
  return (db.prepare(`SELECT p.id, pp.path, p.name, p.slug, p.goal, p.stage, p.meta_json, p.updated_at FROM soloyard_projects p
      JOIN soloyard_project_paths pp ON pp.project_id = p.id WHERE substr(pp.path, 1, ?) = ? ORDER BY p.updated_at DESC`).all(base.length, base) as Row[])
    .map(({ meta_json, ...r }) => ({ ...(r as Idea), note: meta_json ? JSON.parse(meta_json).stage_note ?? null : null }))
}

/** 应用启动时补上：工作区里已有的头脑风暴文件夹（这个功能之前开的）各建一条想法项目。 */
export function backfillIdeas(db: DB, root: string) {
  if (!existsSync(root)) return 0
  let n = 0
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    if (!projectAt(db, join(root, e.name))) {
      ideaForPath(db, 'system:backfill', join(root, e.name))
      n++
    }
  }
  return n
}

/** 头脑风暴文件夹改名后跟着改路径。 */
export function moveIdeaPath(db: DB, from: string, to: string) {
  db.prepare('UPDATE soloyard_project_paths SET path = ? WHERE path = ?').run(clean(to), clean(from))
}

/** 删除头脑风暴时一起删掉它的想法项目（overview、决策、证据随之级联删除）。只删想法期的。 */
export function deleteIdea(db: DB, actor: Actor, path: string) {
  const p = projectAt(db, path)
  if (p && (p.stage === 'idea' || p.stage === 'parked' || p.stage === 'killed') && String(p.key).startsWith('~')) remove(db, actor, 'projects', p.id)
}

/** 按英文名给一个没被占用的前缀：xhs-coach → XC，太短就取前几个字母（XHS），冲突加数字。 */
export function suggestKey(db: DB, slug: string, exceptId?: number) {
  const parts = slug.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  // 多个词取首字母，一个词取前三个字母
  let base = parts.length > 1 ? parts.map((p) => p[0]).join('') : (parts[0] ?? '').slice(0, 3)
  base = base.replace(/^[^A-Z]+/, '').slice(0, 8)
  if (base.length < 2) base = 'PRJ'
  const taken = (k: string) => !!db.prepare('SELECT 1 FROM soloyard_projects WHERE key = ? AND id != ?').get(k, exceptId ?? -1)
  let key = base
  for (let i = 2; taken(key); i++) key = `${base}${i}`
  return key
}

export type PromoteInput = { name: string; slug: string; key: string; goal: string; path: string }

/** 提升前的检查（不改任何东西）：返回第一个问题，没问题返回 null。 */
export function checkPromote(db: DB, ideaPath: string, input: Omit<PromoteInput, 'path'> & { path?: string }): string | null {
  const p = projectAt(db, ideaPath)
  if (!p) return '找不到这个头脑风暴的想法项目'
  if (p.stage !== 'idea') return '这个头脑风暴已经提升过了'
  if (!input.name.trim()) return '项目名称不能为空'
  if (!SLUG.test(input.slug)) return '英文名只能用小写字母、数字和短横线，比如 xhs-coach'
  if (!KEY.test(input.key)) return 'issue 前缀要大写字母开头，2–10 位大写字母或数字，比如 XHS'
  if (db.prepare('SELECT 1 FROM soloyard_projects WHERE key = ? AND id != ?').get(input.key, p.id)) return `issue 前缀 ${input.key} 已经被别的项目用了`
  if (input.path && existsSync(input.path) && readdirSync(input.path).length) return `${input.path} 已经存在而且不是空的`
  return null
}

/** 提升为项目：想法项目换成项目文件夹、填前缀、阶段改成立项；标题 / 英文名 / 一句话按用户在弹窗里确认的写进 overview。 */
export function promoteIdea(db: DB, actor: Actor, ideaPath: string, input: PromoteInput) {
  const problem = checkPromote(db, ideaPath, { ...input, path: undefined })
  if (problem) throw new Error(problem)
  const p = projectAt(db, ideaPath)!
  tx(db, () => {
    update(db, actor, 'projects', p.id, { key: input.key, stage: 'initiating' })
    db.prepare('UPDATE soloyard_project_paths SET path = ? WHERE project_id = ? AND path = ?').run(clean(input.path), p.id, clean(ideaPath))
    updateOverview(db, actor, p.id, [
      { key: 'name', body: input.name.trim() },
      { key: 'slug', body: input.slug },
      { key: 'goal', body: input.goal.trim() },
    ])
  })
  writeSnapshot(db, p.id)
  return getRow(db, 'projects', p.id)!
}

/** 项目设置：改 issue 前缀（还没有 issue 时才行，否则编号全乱）。 */
export function setProjectKey(db: DB, actor: Actor, projectId: number, key: string) {
  if (!KEY.test(key)) throw new Error('issue 前缀要大写字母开头，2–10 位大写字母或数字，比如 XHS')
  if (db.prepare('SELECT 1 FROM soloyard_issues WHERE project_id = ? LIMIT 1').get(projectId)) throw new Error('项目已经有 issue 了，前缀不能再改')
  if (db.prepare('SELECT 1 FROM soloyard_projects WHERE key = ? AND id != ?').get(key, projectId)) throw new Error(`issue 前缀 ${key} 已经被别的项目用了`)
  return update(db, actor, 'projects', projectId, { key })
}
