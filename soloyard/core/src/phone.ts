/**
 * Soloyard：手机经网关请电脑做的 issue 相关的事（SOL-100，原型 v1 A）。在电脑的数据进程里跑，
 * 只开 PHONE_METHODS 这几样给手机，别的（迭代规划、删东西、改项目）手机碰不到。
 */
import type { DB } from './db.ts'
import * as repo from './repo.ts'

type Row = Record<string, any>

/**
 * 首页 Issues 栏一次要的：项目、当前迭代和进度、issue 列表（带挂着的会话），以及每个会话挂的 issue（会话行上的编号、会话页顶上那一条）。
 * 这个目录不属于任何项目时是 null。
 */
export function projectIssues(db: DB, cwd: string) {
  const project = repo.findProjectByPath(db, cwd)
  if (!project) return null
  const issues = repo.listIssues(db, { projectId: project.id }) as Row[]
  const iteration = db.prepare("SELECT id, tag, name FROM soloyard_iterations WHERE project_id = ? AND status = 'active' ORDER BY sort, id LIMIT 1")
    .get(project.id) as Row | undefined
  const current = issues.filter((i) => i.iteration_current)
  const ids = new Set(issues.map((i) => String(i.id)))
  const sessions = new Map<string, string[]>()
  for (const link of db.prepare("SELECT session_id, target FROM soloyard_session_links WHERE kind = 'issue' ORDER BY created_at DESC").all() as Row[]) {
    if (!ids.has(link.target)) continue
    sessions.set(link.target, [...(sessions.get(link.target) ?? []), link.session_id])
  }
  const brief = (i: Row) => ({ id: i.id, ident: i.ident, title: i.title, status: i.status, priority: i.priority })
  const sessionIssues: Record<string, ReturnType<typeof brief>> = {}
  for (const i of issues) for (const sid of sessions.get(String(i.id)) ?? []) sessionIssues[sid] ??= brief(i)
  return {
    project: { id: project.id, key: project.key, name: project.name },
    iteration: iteration
      ? { id: iteration.id, tag: iteration.tag, name: iteration.name, done: current.filter((i) => i.status === 'done').length, total: current.length }
      : null,
    issues: issues.map((i) => ({ ...brief(i), current: !!i.iteration_current, sessions: sessions.get(String(i.id)) ?? [] })),
    sessionIssues,
  }
}

/** 手机改 issue 只能改这几项。 */
const PATCHABLE = ['status', 'priority'] as const

/** 手机能调的（名字 → 参数怎么转给数据进程的同名方法）；不在这里的一律不给。 */
export const PHONE_METHODS: Record<string, (args: unknown[]) => [string, unknown[]]> = {
  projectIssues: ([cwd]) => ['projectIssues', [String(cwd)]],
  getIssue: ([id]) => ['getIssue', [Number(id)]],
  createIssue: ([projectId, input]) => {
    const i = (input ?? {}) as Row
    if (typeof i.title !== 'string' || !i.title.trim()) throw new Error('Invalid title')
    return ['createIssue', [Number(projectId), { title: i.title.trim(), ...(Number.isInteger(i.priority) ? { priority: i.priority } : {}) }]]
  },
  updateIssue: ([id, patch]) => {
    const p = (patch ?? {}) as Row
    const clean = Object.fromEntries(PATCHABLE.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))
    if (!Object.keys(clean).length) throw new Error('Nothing to change')
    return ['updateIssue', [Number(id), clean]]
  },
  addComment: ([id, body]) => ['addComment', [Number(id), String(body)]],
  mergeIssueBranch: ([id]) => ['mergeIssueBranch', [Number(id)]],
  linkIssue: ([sessionId, issueId]) => ['linkSession', [String(sessionId), 'issue', String(Number(issueId))]],
}
