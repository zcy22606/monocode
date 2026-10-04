#!/usr/bin/env node
/**
 * Soloyard 的 stdio MCP 服务：让 Claude Code / Codex 直接读写应用里的项目和 issue。
 * 零依赖：MCP 的 stdio 传输就是一行一个 JSON-RPC 2.0 消息，这里只实现 initialize / tools/list / tools/call / ping。
 *
 * 环境变量：SOLOYARD_ACTOR（写进变更历史，如 agent:claude-code）、SOLOYARD_DB（默认应用数据目录里的 monocode.db）。
 */
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { openDb, tx } from '../core/src/db.ts'
import * as repo from '../core/src/repo.ts'
import * as iter from '../core/src/iterations.ts'
import { importProductThinking } from '../core/src/import-pt.ts'

const actor = process.env.SOLOYARD_ACTOR ?? 'agent:unknown'
// 数据目录沿用 dev.indiedesk.desktop；改成 Soloyard 命名放在改名任务（SOL-6）里，连同数据迁移一起做
export const DEFAULT_DB = join(homedir(), 'Library/Application Support/dev.indiedesk.desktop/monocode.db')
const db = openDb(process.env.SOLOYARD_DB ?? DEFAULT_DB)

const INSTRUCTIONS = `Soloyard 是用户的项目台（项目、issue、验收）。规则：
- 开工前用 get_project（传当前工作目录 path）拿到项目 key，再 list_issues / get_issue 读要做的事。
- 开始做某个 issue：update_issue 改成 in_progress。做完：改成 in_review，并 add_comment 写清改了什么、怎么验证的（命令和结果）。不要改成 done，验收是用户的事。
- 发现要拆的子任务或前置依赖：create_issues（可带 parent / blocked_by / acceptance）。
- 手里的数据可能旧了就带 expected_version；收到 version_conflict 按返回的 latest 重新决定，不要硬覆盖用户的改动。
- 迭代（带版本号的规划表）：get_iteration_plan 看全貌，再传 iteration 看某个迭代的功能。可以 create_iteration、create_features、move_features（挪到别的迭代 / pending 待定 / split 另立项）。
  开始 / 完成 / 删除迭代、把功能标「不做」都由用户在应用里决定，agent 不做。
- 跑 product-thinking 时：命令结束后 import_product_thinking 写进应用；命令开始前 get_iteration_plan 读用户在应用里挪过的功能，以应用为准。`

type Json = Record<string, any>
const str = (description: string) => ({ type: 'string', description })
const issueRef = { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'issue 的数字 id 或编号（如 SOL-12）' }
const projectRef = { anyOf: [{ type: 'number' }, { type: 'string' }], description: '项目 id、key（如 SOL）或目录绝对路径' }
const STATUS = { type: 'string', enum: repo.STATUSES }
const newIssueSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: str('标题'), body_md: str('描述（markdown）'), status: STATUS, priority: { type: 'number', description: '0 无 / 1 紧急 / 2 高 / 3 中 / 4 低' },
    labels: { type: 'array', items: { type: 'string' } }, acceptance: { type: 'array', items: { type: 'string' }, description: '验收标准，一条一项' },
    parent: issueRef, blocked_by: { type: 'array', items: issueRef, description: '前置 issue' },
  },
}

/** 目录 → 项目：先按关联目录（含子目录）找；找不到再看是不是某个仓库的 worktree，按主仓库目录找。不自动建项目。 */
function projectByPath(path: string) {
  const direct = repo.findProjectByPath(db, path)
  if (direct) return direct
  try {
    const common = execFileSync('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
    const main = repo.findProjectByPath(db, dirname(common))
    if (main) return main
  } catch {
    // 不是 git 仓库
  }
  return undefined
}
function project(ref: unknown) {
  const p = typeof ref === 'string' && ref.startsWith('/') ? projectByPath(ref) : repo.findProject(db, ref as string | number)
  if (!p) throw new Error(`找不到项目 ${ref}。先在 Soloyard 里打开这个文件夹的 Project 分页，或用 list_projects 查 key。`)
  return p
}

/** 迭代按版本号找（v1.0 和 1.0 算同一个）。 */
function iterationByTag(projectId: number, tag: string) {
  const norm = (v: string) => v.trim().toLowerCase().replace(/^v/, '')
  const hit = iter.iterationPlan(db, projectId).iterations.find((i) => norm(i.tag) === norm(String(tag)))
  if (!hit) throw new Error(`找不到迭代 ${tag}（用 get_iteration_plan 查版本号）`)
  return hit
}
/** agent 能把功能放去的地方：某个迭代的版本号、pending、split。「不做」只能用户定。 */
function agentTarget(projectId: number, to: string): iter.Target {
  if (to === 'cut') throw new Error('不能由 agent 把功能标成「不做」：这是用户的减法决定，可以挪到 pending 待定并说明理由')
  if (to === 'pending' || to === 'split') return to
  return iterationByTag(projectId, to).id
}
const featureBrief = (f: Json) => ({ code: f.code, name: f.name, level: f.level ?? undefined, issue: f.issue_ident ? `${f.issue_ident} (${f.issue_status})` : undefined })

const TOOLS: { name: string; description: string; inputSchema: Json; run: (a: Json) => unknown }[] = [
  {
    name: 'list_projects', description: '列出所有项目：key、名称、关联目录、未完成和待验收的 issue 数',
    inputSchema: { type: 'object', properties: {} }, run: () => repo.listProjects(db),
  },
  {
    name: 'get_project', description: '按目录（传当前工作目录即可，worktree 也行）或 key 找项目。开工前先调它拿项目 key。',
    inputSchema: { type: 'object', required: ['project'], properties: { project: projectRef } },
    run: ({ project: ref }) => {
      const p = project(ref)
      return { ...p, open_issues: repo.listIssues(db, { projectId: p.id, status: ['backlog', 'todo', 'in_progress', 'in_review'] }).map(({ id, ident, title, status, priority }) => ({ id, ident, title, status, priority })) }
    },
  },
  {
    name: 'list_issues', description: '列出项目的 issue。ready=true 只列可开工的（未开始且前置都已完成）',
    inputSchema: { type: 'object', required: ['project'], properties: { project: projectRef, status: { type: 'array', items: STATUS }, ready: { type: 'boolean' }, q: str('标题 / 描述关键词') } },
    run: ({ project: ref, status, ready, q }) => repo.listIssues(db, { projectId: project(ref).id, status, ready, q })
      .map(({ id, ident, title, status, priority, labels, version }) => ({ id, ident, title, status, priority, labels, version })),
  },
  {
    name: 'get_issue', description: '读一个 issue 的全部：描述、验收标准、子任务、前置、评论、关联会话',
    inputSchema: { type: 'object', required: ['issue'], properties: { issue: issueRef } },
    run: ({ issue }) => repo.getIssue(db, repo.findIssueId(db, issue)),
  },
  {
    name: 'create_issues', description: '批量新建 issue（可带验收标准、父 issue、前置）。一次事务。',
    inputSchema: { type: 'object', required: ['project', 'issues'], properties: { project: projectRef, issues: { type: 'array', items: newIssueSchema } } },
    run: ({ project: ref, issues }) => {
      const pid = project(ref).id
      const ids = tx(db, () => (issues as Json[]).map(({ parent, blocked_by, ...i }) => repo.createIssue(db, actor, pid, {
        ...(i as repo.NewIssue),
        parent_id: parent != null ? repo.findIssueId(db, parent) : undefined,
        blocked_by: (blocked_by ?? []).map((b: unknown) => repo.findIssueId(db, b as string)),
      })))
      return repo.listIssues(db, { projectId: pid, includeSubIssues: true }).filter((i) => ids.includes(i.id)).map(({ id, ident, title }) => ({ id, ident, title }))
    },
  },
  {
    name: 'update_issue', description: '修改 issue（状态、标题、描述、优先级、标签）。带 expected_version 时版本不符会拒绝并返回最新值。做完改 in_review，不要改 done。',
    inputSchema: { type: 'object', required: ['issue'], properties: {
      issue: issueRef, expected_version: { type: 'number' }, status: STATUS, title: str('标题'), body_md: str('描述'),
      priority: { type: 'number' }, labels: { type: 'array', items: { type: 'string' } },
    } },
    run: ({ issue, expected_version, ...patch }) => {
      if (patch.status === 'done') throw new Error('不能由 agent 改成 done：做完请改成 in_review 并评论，验收由用户来做')
      return repo.updateIssue(db, actor, repo.findIssueId(db, issue), patch, expected_version)
    },
  },
  {
    name: 'add_comment', description: '在 issue 下留评论：进度、做完的证据（改了哪些文件、跑了什么命令、结果）、遇到的问题',
    inputSchema: { type: 'object', required: ['issue', 'body_md'], properties: { issue: issueRef, body_md: str('评论（markdown）') } },
    run: ({ issue, body_md }) => ({ id: repo.addComment(db, actor, repo.findIssueId(db, issue), body_md) }),
  },
  {
    name: 'get_iteration_plan',
    description: '迭代表：不传 iteration 时返回所有迭代（版本号、名称、目标、状态、功能数）和待定 / 另立项 / 不做的功能数；传 iteration（版本号，或 pending / split / cut）返回那一列的功能；moved=true 返回位置和 AI 安排（ai_plan）不一样的功能，也就是用户挪过的。迭代的先后就是优先级。',
    inputSchema: { type: 'object', required: ['project'], properties: { project: projectRef, iteration: str('版本号如 v1.0，或 pending / split / cut'), moved: { type: 'boolean', description: '只列用户挪过的功能' } } },
    run: ({ project: ref, iteration, moved }) => {
      const plan = iter.iterationPlan(db, project(ref).id)
      const where = (f: Json) => f.iteration_id ?? f.bucket
      const at = (f: Json) => (f.iteration_id ? plan.iterations.find((i) => i.id === f.iteration_id)?.tag : f.bucket)
      if (moved) return plan.features.filter((f) => f.ai_plan && f.ai_plan !== at(f)).map((f) => ({ code: f.code, name: f.name, ai_plan: f.ai_plan, at: at(f) }))
      if (iteration != null) {
        const target = iter.BUCKETS.includes(iteration) ? iteration : iterationByTag(project(ref).id, iteration).id
        return plan.features.filter((f) => where(f) === target).map(featureBrief)
      }
      return {
        iterations: plan.iterations.map((i) => ({
          tag: i.tag, name: i.name, goal: i.goal || undefined, status: i.status, target_date: i.target_date ?? undefined,
          features: plan.features.filter((f) => f.iteration_id === i.id).length,
        })),
        ...Object.fromEntries(iter.BUCKETS.map((b) => [b, plan.features.filter((f) => !f.iteration_id && f.bucket === b).length])),
      }
    },
  },
  {
    name: 'create_iteration', description: '新建迭代（只建，不开始）。版本号必填且不能重复；before 传某个版本号表示排在它前面，不传排最后。',
    inputSchema: { type: 'object', required: ['project', 'tag'], properties: {
      project: projectRef, tag: str('版本号，如 v1.2'), name: str('名称'), goal: str('这个版本做完用户能做到什么'), target_date: str('目标日期 YYYY-MM-DD'), before: str('排在这个版本号前面'),
    } },
    run: ({ project: ref, tag, name, goal, target_date, before }) => {
      const pid = project(ref).id
      const id = iter.createIteration(db, actor, pid, { tag, name, goal, target_date }, before ? iterationByTag(pid, before).id : null)
      return { id, tag }
    },
  },
  {
    name: 'create_features', description: '新建功能（编号自动 F-001 往下排），放到某个迭代（版本号）或 pending 待定（默认）/ split 另立项。',
    inputSchema: { type: 'object', required: ['project', 'features'], properties: {
      project: projectRef, to: str('版本号，或 pending / split，默认 pending'),
      features: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: str('功能名'), backbone: str('骨干编号，可选') } } },
    } },
    run: ({ project: ref, to, features }) => {
      const pid = project(ref).id
      const target = agentTarget(pid, to ?? 'pending')
      const ids = tx(db, () => (features as Json[]).map((f) => iter.createFeature(db, actor, pid, { name: f.name, backbone: f.backbone }, target)))
      return iter.iterationPlan(db, pid).features.filter((f) => ids.includes(f.id)).map(featureBrief)
    },
  },
  {
    name: 'move_features', description: '把功能挪到别的迭代（版本号）、pending 待定或 split 另立项；已建的 issue 跟着走。已完成的迭代锁定，进出都不行。不能挪到「不做」。',
    inputSchema: { type: 'object', required: ['project', 'codes', 'to'], properties: {
      project: projectRef, codes: { type: 'array', items: { type: 'string' }, description: '功能编号，如 ACCT-001' }, to: str('版本号，或 pending / split'),
    } },
    run: ({ project: ref, codes, to }) => {
      const pid = project(ref).id
      const byCode = new Map(iter.iterationPlan(db, pid).features.map((f) => [f.code, f.id]))
      const ids = (codes as string[]).map((c) => {
        const id = byCode.get(c)
        if (id == null) throw new Error(`找不到功能 ${c}`)
        return id
      })
      iter.moveFeatures(db, actor, ids, agentTarget(pid, to))
      return { moved: ids.length, to }
    },
  },
  {
    name: 'import_product_thinking',
    description: 'product-thinking 每个命令结束、pt.py check 通过后调用：把项目目录里的立项卡等文档、证据、决策、功能全景和版本表写进 Soloyard。按编号覆盖，重复导入安全：用户在应用里挪过的功能、做过的决定都保留。project 传目录绝对路径时，还没有项目就按这个目录新建。',
    inputSchema: { type: 'object', required: ['dir', 'project'], properties: {
      dir: str('product-thinking 项目目录的绝对路径（含 project.json）'), project: projectRef,
    } },
    run: ({ dir, project: ref }) => {
      let p = typeof ref === 'string' && ref.startsWith('/') ? projectByPath(ref) : repo.findProject(db, ref as string | number)
      if (!p && typeof ref === 'string' && ref.startsWith('/')) {
        p = repo.getRow(db, 'projects', repo.createProject(db, actor, { name: ref.split('/').filter(Boolean).at(-1) ?? ref, path: ref }))
      }
      if (!p) throw new Error(`找不到项目 ${ref}`)
      return { project: p.key, ...importProductThinking(db, actor, dir, p.id) }
    },
  },
  {
    name: 'add_acceptance', description: '给 issue 加一条验收标准',
    inputSchema: { type: 'object', required: ['issue', 'text'], properties: { issue: issueRef, text: str('验收标准') } },
    run: ({ issue, text }) => ({ id: repo.addAcceptance(db, actor, repo.findIssueId(db, issue), text) }),
  },
]

const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id: unknown, result: unknown) => send({ jsonrpc: '2.0', id, result })

function callTool(name: string, args: Json) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] }
  try {
    return { content: [{ type: 'text', text: JSON.stringify(tool.run(args ?? {}) ?? null, null, 2) }] }
  } catch (e) {
    const latest = e instanceof repo.VersionConflict ? e.latest : undefined
    const error = latest ? 'version_conflict：数据已被别人改过，按 latest 重新决定后再写' : e instanceof Error ? e.message : String(e)
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error, ...(latest ? { latest } : {}) }) }] }
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: Json
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) return // 通知（notifications/initialized 等）不用回
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'soloyard', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return reply(msg.id, {})
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call':
      return reply(msg.id, callTool(msg.params?.name, msg.params?.arguments))
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
  }
}).on('close', () => process.exit(0))
