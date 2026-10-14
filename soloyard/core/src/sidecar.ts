/**
 * 应用的数据进程：由 Rust（soloyard_bridge.rs）拉起，stdin / stdout 一行一个 JSON。
 *   请求  {"id":1,"method":"listIssues","args":[{...}]}
 *   回应  {"id":1,"result":...} 或 {"id":1,"error":"...","latest":{...}}
 *   通知  {"event":"changed"}   —— 库被改了（自己写的，或 MCP / 其他进程写的），界面据此刷新
 * 用法：node sidecar.ts <db 路径>
 */
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { openDb } from './db.ts'
import * as repo from './repo.ts'
import * as it from './iterations.ts'
import * as repos from './repos.ts'
import * as merge from './merge.ts'
import * as stage from './stage.ts'
import * as overview from './overview.ts'
import * as ideas from './ideas.ts'
import * as decisions from './decisions.ts'
import { exportDocuments } from './docs-export.ts'
import * as docs from './docs.ts'

const path = process.argv[2]
if (!path) {
  process.stderr.write('usage: node sidecar.ts <db path>\n')
  process.exit(2)
}
const db = openDb(path)
const actor = 'user'
// 头脑风暴的工作区和库在同一个应用数据目录里；这个功能之前开的头脑风暴各补一条想法项目
const workspace = join(dirname(path), 'workspace')
// 开发版的库在 dev.indiedesk.desktop.dev 下，它注册的 MCP 叫 soloyard-dev（src-tauri/src/soloyard_agents.rs）
const mcpName = dirname(path).endsWith('.dev') ? 'soloyard-dev' : 'soloyard'
const inWorkspace = (p: string) => p.replace(/\/+$/, '').startsWith(workspace + '/')
try {
  ideas.backfillIdeas(db, workspace)
} catch (e) {
  process.stderr.write(`backfill ideas: ${e}\n`)
}

// 文档改成以项目 docs/ 里的文件为准：表里还有没导出的就写成文件（导过的记在项目 meta，不重复）。stdout 是协议，日志走 stderr
try {
  const { written } = exportDocuments(db, (msg) => process.stderr.write(msg + '\n'))
  if (written.length) process.stderr.write(`soloyard: exported ${written.length} document(s) to docs/\n`)
} catch (e) {
  process.stderr.write(`soloyard: document export failed: ${e instanceof Error ? e.message : String(e)}\n`)
}

/** 界面能调的方法（白名单）。写操作在名字里标 write，执行后广播 changed。 */
const METHODS: Record<string, { write?: boolean; run: (...args: any[]) => unknown }> = {
  // 不广播：只在第一次打开时建项目，调用方直接拿返回值；广播会让读它的界面反复重取
  // 头脑风暴的工作文件夹对应想法项目，不当普通项目建
  projectForPath: { run: (p: string) => (inWorkspace(p) ? ideas.ideaForPath(db, actor, p) : repo.projectForPath(db, p)) },
  listIssues: { run: (f: repo.IssueFilter) => repo.listIssues(db, f) },
  getIssue: { run: (id: number) => repo.getIssue(db, id) ?? null },
  projectLabels: { run: (projectId: number) => repo.projectLabels(db, projectId) },
  createIssue: { write: true, run: (projectId: number, i: repo.NewIssue) => it.createIssueInIteration(db, actor, projectId, i) },
  updateIssue: { write: true, run: (id: number, patch: repo.Row, expected?: number) => repo.updateIssue(db, actor, id, patch, expected) },
  updateIssues: { write: true, run: (ids: number[], patch: repo.Row) => repo.updateIssues(db, actor, ids, patch) },
  addAcceptance: { write: true, run: (issueId: number, text: string) => repo.addAcceptance(db, actor, issueId, text) },
  updateAcceptance: { write: true, run: (id: number, patch: repo.Row) => repo.updateAcceptance(db, actor, id, patch) },
  removeAcceptance: { write: true, run: (id: number) => repo.removeAcceptance(db, actor, id) },
  addComment: { write: true, run: (issueId: number, body: string) => repo.addComment(db, actor, issueId, body) },
  linkSession: { write: true, run: (sessionId: string, kind: string, target: string) => repo.linkSession(db, sessionId, kind, target) },
  unlinkSession: { write: true, run: (sessionId: string, kind: string, target: string) => repo.unlinkSession(db, sessionId, kind, target) },
  sessionLinks: { run: (sessionId: string) => repo.sessionLinks(db, sessionId) },
  sessionsUnder: { run: (root: string) => repo.listSessionsUnder(db, root) },
  createProjectAt: { write: true, run: (name: string, path: string) => repo.createProject(db, actor, { name, path }) },
  addDocument: { write: true, run: (projectId: number, d: { title: string; body_md: string; kind?: string }) => repo.addDocument(db, actor, projectId, d) },
  // 关联的文件夹 + 项目的成员仓库（--add-dir / 可写目录），@ 到的关联内容，以及项目地图（系统提示）
  sessionContext: {
    run: (sessionId: string, message?: string, cwd?: string, workCwd?: string) => {
      const links = repo.sessionContext(db, sessionId, message)
      const project = repos.projectSessionContext(db, cwd, workCwd, mcpName)
      return { ...links, dirs: [...new Set([...links.dirs, ...project.dirs])], map: project.map }
    },
  },
  projectRepos: { run: (path: string) => repos.projectRepos(db, path) },
  // 验收即合并：issue 工作树的分支合进仓库主检出（只动 git，不改库，所以不广播）
  issueBranch: { run: (issueId: number) => merge.issueBranch(db, issueId) },
  mergeIssueBranch: { run: (issueId: number) => merge.mergeIssueBranch(db, issueId) },
  projectMap: { run: (cwd: string, workCwd?: string) => repos.projectSessionContext(db, cwd, workCwd, mcpName).map },
  memberRepoPaths: { run: () => repos.memberRepoPaths(db) },
  setupSuggestion: { run: (cwd: string) => repos.setupSuggestion(db, cwd) },
  mergeIntoParent: { write: true, run: (cwd: string, parent: string, paths: string[]) => repos.mergeIntoParent(db, actor, cwd, parent, paths) },
  scanRepos: { run: (projectId: number) => repos.scanRepos(db, projectId) },
  addProjectRepo: { write: true, run: (projectId: number, path: string, description?: string) => repos.addProjectRepo(db, actor, projectId, path, description) },
  updateProjectRepo: { write: true, run: (id: number, patch: { description?: string; sort?: number }) => repos.updateProjectRepo(db, actor, id, patch) },
  removeProjectRepo: { write: true, run: (id: number) => repos.removeProjectRepo(db, actor, id) },
  setProjectInstructions: { write: true, run: (projectId: number, text: string) => repos.setProjectInstructions(db, actor, projectId, text) },
  linkCandidates: { run: (projectId: number, kind: string, q?: string) => repo.linkCandidates(db, projectId, kind, q) },
  findProjectByPath: { run: (p: string) => repo.findProjectByPath(db, p) ?? null },
  listProjects: { run: () => repo.listProjects(db) },
  projectStage: { run: (projectId: number) => stage.projectStage(db, projectId) },
  getOverview: { run: (projectId: number) => overview.getOverview(db, projectId) },
  updateOverview: { write: true, run: (projectId: number, updates: overview.OverviewUpdate[]) => overview.updateOverview(db, actor, projectId, updates) },
  // 想法项目（头脑风暴）和提升为项目
  ideaForPath: { write: true, run: (p: string) => ideas.ideaForPath(db, actor, p) },
  ideasUnder: { run: (root: string) => ideas.ideasUnder(db, root) },
  moveIdeaPath: { write: true, run: (from: string, to: string) => ideas.moveIdeaPath(db, from, to) },
  deleteIdea: { write: true, run: (p: string) => ideas.deleteIdea(db, actor, p) },
  suggestKey: { run: (slug: string, exceptId?: number) => ideas.suggestKey(db, slug, exceptId) },
  checkPromote: { run: (ideaPath: string, input: ideas.PromoteInput) => ideas.checkPromote(db, ideaPath, input) },
  promoteIdea: { write: true, run: (ideaPath: string, input: ideas.PromoteInput) => ideas.promoteIdea(db, actor, ideaPath, input) },
  setProjectKey: { write: true, run: (projectId: number, key: string) => ideas.setProjectKey(db, actor, projectId, key) },
  // 决策和证据：用户在 Decisions 页拍板（via 应用）、双向门一键采纳 AI 建议
  listDecisions: { run: (projectId: number) => decisions.listDecisions(db, projectId) },
  decide: { write: true, run: (projectId: number, code: string, option: string, note?: string) => decisions.decide(db, actor, projectId, code, { option, note, via: '应用' }) },
  adoptTwoWay: { write: true, run: (projectId: number) => decisions.adoptTwoWay(db, actor, projectId) },
  listEvidence: { run: (projectId: number, filter?: { codes?: string[]; q?: string }) => decisions.listEvidence(db, projectId, filter) },
  // 文档：项目根目录和成员仓库 docs/ 里的文件（数据库不存），新建按规范续编号
  listDocs: { run: (cwd: string) => docs.listDocs(db, cwd) },
  docConvention: { run: () => docs.DOC_CONVENTION },
  newDoc: { run: (cwd: string, input: docs.NewDocInput) => docs.newDoc(db, cwd, { ...input, author: input.author ?? '用户' }) },
  setProjectStage: { write: true, run: (projectId: number, to: stage.StageChange, reason?: string) => stage.setProjectStage(db, actor, projectId, to, reason) },
  iterationPlan: { run: (projectId: number) => it.iterationPlan(db, projectId) },
  createIteration: { write: true, run: (projectId: number, input: it.IterationInput, beforeId: number | null) => it.createIteration(db, actor, projectId, input, beforeId) },
  updateIteration: { write: true, run: (id: number, patch: Partial<it.IterationInput>) => it.updateIteration(db, actor, id, patch) },
  moveIteration: { write: true, run: (id: number, beforeId: number | null) => it.moveIteration(db, actor, id, beforeId) },
  deleteIteration: { write: true, run: (id: number, moveTo: it.Target) => it.deleteIteration(db, actor, id, moveTo) },
  startIteration: { write: true, run: (id: number, featureIds: number[]) => it.startIteration(db, actor, id, featureIds) },
  finishIteration: { write: true, run: (id: number, moves: Record<string, it.Target>) => it.finishIteration(db, actor, id, moves) },
  reopenIteration: { write: true, run: (id: number) => it.reopenIteration(db, actor, id) },
  generateIterations: { write: true, run: (projectId: number) => it.generateIterations(db, actor, projectId) },
  moveFeatures: { write: true, run: (ids: number[], target: it.Target) => it.moveFeatures(db, actor, ids, target) },
  createFeature: { write: true, run: (projectId: number, input: { name: string }, target: it.Target) => it.createFeature(db, actor, projectId, input, target) },
  renameFeature: { write: true, run: (id: number, name: string) => it.renameFeature(db, actor, id, name) },
  deleteFeature: { write: true, run: (id: number) => it.deleteFeature(db, actor, id) },
  createFeatureIssue: { write: true, run: (featureId: number) => it.createFeatureIssue(db, actor, featureId) },
  parkIssue: { write: true, run: (issueId: number, target?: it.Target) => it.parkIssue(db, actor, issueId, target) },
  revertBatch: { write: true, run: (batch: string) => it.revertBatch(db, actor, batch) },
  undo: { write: true, run: () => repo.undoLast(db, actor) },
  redo: { write: true, run: () => repo.redoLast(db, actor) },
}

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')

// 其他连接改了库时 data_version 会变（自己写的不变，写完单独广播）。底座聊天时也在频繁写库，
// 所以再比一下我们自己的数据签名：变更日志的最大 id + 会话关联数，只有它变了才广播。
const version = () => (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version
const signature = () => (db.prepare(`SELECT (SELECT COALESCE(MAX(id), 0) FROM soloyard_changes) || ':' ||
  (SELECT COUNT(*) FROM soloyard_session_links) AS s`).get() as { s: string }).s
let lastVersion = version()
let lastSignature = signature()
setInterval(() => {
  const v = version()
  if (v === lastVersion) return
  lastVersion = v
  const sig = signature()
  if (sig === lastSignature) return
  lastSignature = sig
  send({ event: 'changed' })
}, 250).unref() // 验收要求 agent 写的 1 秒内出现在界面上；PRAGMA data_version 很便宜

createInterface({ input: process.stdin }).on('line', (line) => {
  let req: { id: number; method: string; args?: unknown[] }
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  const m = METHODS[req.method]
  if (!m) return send({ id: req.id, error: `unknown method: ${req.method}` })
  try {
    const result = m.run(...(req.args ?? []))
    send({ id: req.id, result: result ?? null })
    if (m.write) {
      lastSignature = signature() // 自己写的已经广播过，轮询不再重复
      send({ event: 'changed' })
    }
  } catch (e) {
    send({ id: req.id, error: e instanceof Error ? e.message : String(e), latest: e instanceof repo.VersionConflict || e instanceof overview.OverviewConflict ? e.latest : undefined })
  }
}).on('close', () => process.exit(0))
