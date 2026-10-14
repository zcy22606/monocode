/**
 * 项目 overview（docs/soloyard/project-workflow.md「overview」）：项目的产品说明书，只讲「做什么、为什么」，不放技术。
 * 从头脑风暴第一句起 agent 就一直维护它；用户也能直接改。
 * - 一条一节存在 soloyard_overview：字段（标题、英文名、一句话、止损线）和 9 节正文一样，各有版本和最后改的人。
 *   标题、英文名、一句话同时写回 projects.name / slug / goal，列表、提升、MCP 直接用。
 * - 改一节要带读到时的版本；对不上就拒绝（用户改过的尤其不能被 agent 覆盖），让对方重新读。
 * - 每次改完把整份写成只读快照 <项目文件夹>/docs/overview.md（进 git，给没接 MCP 的 agent 读）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import { tx } from './db.ts'
import { getRow, insert, update, type Actor, type Row } from './repo.ts'
import { projectRoot, projectStage } from './stage.ts'

/** 字段：标题、英文名（文件夹名）、一句话描述、止损线。 */
export const FIELDS = ['name', 'slug', 'goal', 'stoploss'] as const
/** 正文 9 节，按显示顺序。 */
export const SECTIONS = ['background', 'users', 'alternatives', 'findings', 'decisions', 'scope', 'metrics', 'risks', 'open'] as const
export type OverviewKey = (typeof FIELDS)[number] | (typeof SECTIONS)[number]
const KEYS: readonly string[] = [...FIELDS, ...SECTIONS]

/** 快照、MCP 和系统提示用的中文名（界面走 i18n）。 */
export const TITLES: Record<OverviewKey, string> = {
  name: '项目名称', slug: '英文名（文件夹名）', goal: '一句话描述', stoploss: '止损线',
  background: '背景与问题', users: '目标用户', alternatives: '现有替代和竞品', findings: '调研发现', decisions: '关键决策',
  scope: '范围和不做的', metrics: '成功指标', risks: '风险与待验证假设', open: '还没想清楚的',
}

/** 英文名 = 项目文件夹名：小写字母、数字、短横线。 */
export const SLUG = /^[a-z0-9][a-z0-9-]*$/

export type OverviewEntry = { key: OverviewKey; title: string; body: string; version: number; updated_by: string | null; updated_at: string | null }
export type Overview = { project_id: number; entries: OverviewEntry[] }

/** 版本对不上：别人（尤其是用户）在你读过之后改过这一节。 */
export class OverviewConflict extends Error {
  latest: OverviewEntry
  constructor(latest: OverviewEntry) {
    super(latest.updated_by === 'user'
      ? `用户在你读过之后改过「${latest.title}」，不要覆盖：把你的建议在对话里告诉用户`
      : `「${latest.title}」在你读过之后被 ${latest.updated_by} 改过，重新读（get_overview）再决定怎么改`)
    this.latest = latest
  }
}

function rows(db: DB, projectId: number) {
  return new Map((db.prepare('SELECT * FROM soloyard_overview WHERE project_id = ?').all(projectId) as Row[]).map((r) => [r.section as string, r]))
}

export function getOverview(db: DB, projectId: number): Overview {
  const p = getRow(db, 'projects', projectId)
  if (!p) throw new Error(`找不到项目 ${projectId}`)
  const saved = rows(db, projectId)
  return {
    project_id: projectId,
    entries: (KEYS as OverviewKey[]).map((key) => {
      const r = saved.get(key)
      // 字段没在 overview 里写过时，拿项目本身的（添加文件夹建的老项目只有名称）
      const fallback = key === 'name' ? p.name : key === 'slug' ? p.slug ?? '' : key === 'goal' ? p.goal : ''
      return { key, title: TITLES[key], body: r ? r.body_md : fallback, version: r?.version ?? 0, updated_by: r?.updated_by ?? null, updated_at: r?.updated_at ?? null }
    }),
  }
}

export type OverviewUpdate = { key: string; body: string; expected_version?: number }

/**
 * 改几节（一次事务）。expected_version = 读到时的版本（还没写过的节是 0）；不带就不检查（界面上用户自己改时也带）。
 * 标题、英文名、一句话同步到 projects。
 */
export function updateOverview(db: DB, actor: Actor, projectId: number, updates: OverviewUpdate[]) {
  tx(db, () => {
    const saved = rows(db, projectId)
    const current = getOverview(db, projectId)
    for (const u of updates) {
      if (!KEYS.includes(u.key)) throw new Error(`没有「${u.key}」这一节，可选：${KEYS.join(', ')}`)
      const body = u.key === 'slug' ? u.body.trim() : u.body
      if (u.key === 'slug' && body && !SLUG.test(body)) throw new Error('英文名只能用小写字母、数字和短横线，比如 xhs-coach')
      if (u.key === 'name' && !body.trim()) throw new Error('项目名称不能为空')
      const r = saved.get(u.key)
      if (u.expected_version != null && (r?.version ?? 0) !== u.expected_version) {
        throw new OverviewConflict(current.entries.find((e) => e.key === u.key)!)
      }
      if (r) update(db, actor, 'overview', r.id, { body_md: body, updated_by: actor })
      else insert(db, actor, 'overview', { project_id: projectId, section: u.key, body_md: body, updated_by: actor })
      if (u.key === 'name') update(db, actor, 'projects', projectId, { name: body.trim() })
      if (u.key === 'slug') update(db, actor, 'projects', projectId, { slug: body || null })
      if (u.key === 'goal') update(db, actor, 'projects', projectId, { goal: body.trim() })
    }
  })
  writeSnapshot(db, projectId)
  return getOverview(db, projectId)
}

/** 整份 overview 的 markdown（快照文件用）。 */
export function overviewMarkdown(db: DB, projectId: number) {
  const o = getOverview(db, projectId)
  const get = (k: OverviewKey) => o.entries.find((e) => e.key === k)!.body.trim()
  const p = getRow(db, 'projects', projectId)!
  const lines = [
    '<!-- Soloyard 自动生成的只读快照：改 overview 请在应用的概览页，或让 agent 用 MCP update_overview。这里改了会被覆盖。 -->',
    '',
    `# ${get('name') || p.name}`,
    '',
    get('goal') ? `> ${get('goal')}` : '',
    '',
    `- 英文名：${get('slug') || '（未定）'}`,
    `- 阶段：${projectStage(db, projectId).stage}`,
    get('stoploss') ? `- 止损线：${get('stoploss')}` : '',
  ]
  for (const key of SECTIONS) lines.push('', `## ${TITLES[key]}`, '', get(key) || '（还没写）')
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n').trim() + '\n'
}

/** 写快照到 <项目文件夹>/docs/overview.md；项目没有文件夹（或写不了）就跳过。 */
export function writeSnapshot(db: DB, projectId: number) {
  const root = projectRoot(db, projectId)
  if (!root) return
  try {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'overview.md'), overviewMarkdown(db, projectId))
  } catch {
    // 文件夹被删了 / 没权限：快照只是副本，不影响库里的数据
  }
}

/**
 * 头脑风暴的规矩：想法期的项目（每个头脑风暴）在系统提示里带上这段，输入框留给用户自己说。
 * 提升为项目后阶段变了，就不再带。
 */
export const brainstormGuide = () => [
  '## Brainstorm (Soloyard idea project)',
  'This session is a brainstorm. Help the user think the idea through first — who it is for, how they cope today, what would make them switch — and do not rush to conclusions. Reply in the user\'s language.',
  `The current folder is an idea project in Soloyard (the soloyard MCP server\'s get_project with the current folder finds it). From the user\'s first message on, keep its overview current with update_overview: a working title (name), an English name for the future project folder (slug: lowercase letters, digits and dashes), a one-liner (goal), and the sections as they become clear (background, users, alternatives, findings, risks, open). If the direction is not clear yet, title it "Untitled idea" in the user\'s language; when the direction changes, update it. Do not overwrite sections the user edited — suggest instead.`,
  'Record evidence (add_evidence) and decisions (upsert_decisions) in the app, not only in the chat. Ask the user before researching competitors or user voices. Notes and idea cards go into docs/ in the current folder.',
  'Promoting the idea to a project is the user\'s call in the app; do not do it yourself.',
].join('\n')

/** 系统提示里的短摘要：一句话、阶段、已定的单向门；全文让 agent 经 MCP 读。没写过 overview 就是空的。 */
export function overviewSummary(db: DB, projectId: number): string {
  const o = getOverview(db, projectId)
  const goal = o.entries.find((e) => e.key === 'goal')!.body.trim()
  const written = o.entries.some((e) => e.version > 0)
  if (!written && !goal) return ''
  const decided = db.prepare("SELECT code, title FROM soloyard_decisions WHERE project_id = ? AND status = 'decided' ORDER BY id").all(projectId) as Row[]
  const s = projectStage(db, projectId)
  return [
    '## Product overview (Soloyard)',
    goal ? `One-liner: ${goal}` : '',
    `Stage: ${s.stage}${s.step ? ` / ${s.step}` : ''}`,
    decided.length ? `Decided: ${decided.map((d) => `${d.code} ${d.title}`).join('; ')}` : '',
    `Read the full overview with the soloyard MCP tool get_overview. Keep it current (update_overview) when product-level things are decided or learned; technical decisions do not go there.`,
  ].filter(Boolean).join('\n')
}
