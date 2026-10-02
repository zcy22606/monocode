/**
 * 应用的数据进程：由 Rust（soloyard_bridge.rs）拉起，stdin / stdout 一行一个 JSON。
 *   请求  {"id":1,"method":"listIssues","args":[{...}]}
 *   回应  {"id":1,"result":...} 或 {"id":1,"error":"...","latest":{...}}
 *   通知  {"event":"changed"}   —— 库被改了（自己写的，或 MCP / 其他进程写的），界面据此刷新
 * 用法：node sidecar.ts <db 路径>
 */
import { createInterface } from 'node:readline'
import { openDb } from './db.ts'
import * as repo from './repo.ts'

const path = process.argv[2]
if (!path) {
  process.stderr.write('usage: node sidecar.ts <db path>\n')
  process.exit(2)
}
const db = openDb(path)
const actor = 'user'

/** 界面能调的方法（白名单）。写操作在名字里标 write，执行后广播 changed。 */
const METHODS: Record<string, { write?: boolean; run: (...args: any[]) => unknown }> = {
  // 不广播：只在第一次打开时建项目，调用方直接拿返回值；广播会让读它的界面反复重取
  projectForPath: { run: (p: string) => repo.projectForPath(db, p) },
  listIssues: { run: (f: repo.IssueFilter) => repo.listIssues(db, f) },
  getIssue: { run: (id: number) => repo.getIssue(db, id) ?? null },
  projectLabels: { run: (projectId: number) => repo.projectLabels(db, projectId) },
  createIssue: { write: true, run: (projectId: number, i: repo.NewIssue) => repo.createIssue(db, actor, projectId, i) },
  updateIssue: { write: true, run: (id: number, patch: repo.Row, expected?: number) => repo.updateIssue(db, actor, id, patch, expected) },
  addAcceptance: { write: true, run: (issueId: number, text: string) => repo.addAcceptance(db, actor, issueId, text) },
  updateAcceptance: { write: true, run: (id: number, patch: repo.Row) => repo.updateAcceptance(db, actor, id, patch) },
  removeAcceptance: { write: true, run: (id: number) => repo.removeAcceptance(db, actor, id) },
  addComment: { write: true, run: (issueId: number, body: string) => repo.addComment(db, actor, issueId, body) },
  linkSession: { write: true, run: (sessionId: string, kind: string, target: string) => repo.linkSession(db, sessionId, kind, target) },
  unlinkSession: { write: true, run: (sessionId: string, kind: string, target: string) => repo.unlinkSession(db, sessionId, kind, target) },
  sessionLinks: { run: (sessionId: string) => repo.sessionLinks(db, sessionId) },
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
}, 1000).unref()

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
    send({ id: req.id, error: e instanceof Error ? e.message : String(e), latest: e instanceof repo.VersionConflict ? e.latest : undefined })
  }
}).on('close', () => process.exit(0))
