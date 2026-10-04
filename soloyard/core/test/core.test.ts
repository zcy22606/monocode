import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'

test('文件夹对应项目；issue 编号、更新、并发保护、撤销重做', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/work/openroboto')
  assert.equal(p.key, 'OPE')
  assert.equal(r.projectForPath(db, '/work/openroboto').id, p.id, '同一个文件夹不重复建项目')

  const a = r.createIssue(db, 'user', p.id, { title: 'A', labels: ['ui'], acceptance: ['能跑'] })
  const b = r.createIssue(db, 'agent:codex', p.id, { title: 'B', blocked_by: [a] })
  assert.deepEqual(r.listIssues(db, { projectId: p.id }).map((i) => i.ident), ['OPE-1', 'OPE-2'])
  assert.deepEqual(r.listIssues(db, { projectId: p.id, ready: true }).map((i) => i.title), ['A'], 'B 被 A 阻塞')
  assert.deepEqual(r.listIssues(db, { projectId: p.id })[0].labels, ['ui'])

  r.updateIssue(db, 'user', a, { status: 'done', labels: ['ui', 'mvp'] })
  assert.ok(r.getIssue(db, a)!.completed_at)
  assert.deepEqual(r.projectLabels(db, p.id), ['mvp', 'ui'])
  assert.throws(() => r.updateIssue(db, 'agent:codex', b, { title: 'x' }, 99), r.VersionConflict)

  r.undoLast(db)
  assert.equal(r.getIssue(db, a)!.status, 'backlog')
  r.redoLast(db)
  assert.equal(r.getIssue(db, a)!.status, 'done')
})

test('验收项、评论、会话关联', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/x/app')
  const id = r.createIssue(db, 'user', p.id, { title: '登录页' })
  const acc = r.addAcceptance(db, 'user', id, '未登录跳转')
  r.updateAcceptance(db, 'user', acc, { done: 1 })
  r.addComment(db, 'agent:claude-code', id, '改了 auth.ts，测试通过')
  r.linkSession(db, 'sess-1', 'issue', String(id))
  const issue = r.getIssue(db, id)!
  assert.equal(issue.acceptance[0].done, 1)
  assert.equal(issue.comments[0].actor, 'agent:claude-code')
  assert.deepEqual(issue.sessions.map((s) => s.id), ['sess-1'])
  assert.equal(r.listIssues(db, { projectId: p.id })[0].sessions, 1)
  assert.deepEqual(r.sessionLinks(db, 'sess-1').map((l) => l.kind), ['issue'])
})

test('会话关联：多种对象、显示信息、候选、上下文和额外目录', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/x/app')
  const issue = r.createIssue(db, 'user', p.id, { title: '登录页', body_md: '未登录要跳转', acceptance: ['跳到 /login'] })
  const doc = r.insert(db, 'user', 'documents', { project_id: p.id, title: '立项卡', blocks_json: JSON.stringify({ sections: [{ id: 's0', title: '结论', blocks: [{ type: 'text', text: '先做自用切片' }] }] }) })
  const feat = r.insert(db, 'user', 'features', { project_id: p.id, code: 'SES-1', name: '会话关联', module: 'SES' })
  const dec = r.insert(db, 'user', 'decisions', { project_id: p.id, code: 'D-1', title: '桌面框架', status: 'decided',
    data_json: JSON.stringify({ options: [{ key: 'A', label: 'Electron' }, { key: 'B', label: 'Tauri' }], user: { option: 'B', note: '包小' } }) })
  const shared = mkdtempSync(join(tmpdir(), 'shared-'))
  const lib = mkdtempSync(join(tmpdir(), 'lib-'))
  for (const [kind, target] of [['folder', shared], ['file', '/x/spec.md'], ['issue', issue], ['document', doc], ['feature', feat], ['decision', dec], ['folder', lib], ['folder', '/x/gone']] as const)
    r.linkSession(db, 's', kind, String(target))
  assert.throws(() => r.linkSession(db, 's', 'asset', '1'), /unknown link kind/)

  const links = r.sessionLinks(db, 's')
  assert.deepEqual(links.map((l) => [l.kind, l.code, l.title, l.mention]), [
    ['folder', null, basename(shared), `link/${basename(shared)}`], ['file', null, 'spec.md', 'link/spec.md'], ['issue', 'APP-1', '登录页', 'link/APP-1'],
    ['document', null, '立项卡', `link/doc-${doc}`], ['feature', 'SES-1', '会话关联', 'link/SES-1'], ['decision', 'D-1', '桌面框架', 'link/D-1'],
    ['folder', null, basename(lib), `link/${basename(lib)}`], ['folder', null, 'gone', 'link/gone'],
  ])

  // 按需注入：没 @ 就只有目录，没有内容
  assert.deepEqual(r.sessionContext(db, 's'), { dirs: [shared, lib], text: '' }, '不存在的目录不交给 CLI')
  const all = `看下 @link/spec.md @link/APP-1 @link/doc-${doc}，@link/SES-1。还有 @link/D-1`
  const ctx = r.sessionContext(db, 's', all)
  for (const piece of ['Linked file (read it when relevant): /x/spec.md', 'Issue APP-1: 登录页', '未登录要跳转', '- [ ] 跳到 /login', '结论\n先做自用切片', 'Feature SES-1: 会话关联', 'Chosen: B. Tauri', 'Note: 包小'])
    assert.ok(ctx.text.includes(piece), piece)
  const one = r.sessionContext(db, 's', '只要 @link/D-1').text
  assert.ok(one.startsWith('Decision D-1') && !one.includes('APP-1'), '只带 @ 到的')
  assert.ok(r.sessionContext(db, 's', `@link/${basename(lib)}`).text.includes(`Linked folder (readable and writable in addition to the working directory): ${lib}`))
  assert.equal(r.sessionContext(db, 's', 'email@link/APP-1 不算').text, '', '@ 前面要是空白或开头')

  // 对象删了：列表里标 missing，上下文里跳过
  r.remove(db, 'user', 'features', feat)
  assert.equal(r.sessionLinks(db, 's').find((l) => l.kind === 'feature')!.missing, true)
  assert.equal(r.sessionContext(db, 's', '@link/SES-1').text, '')

  assert.deepEqual(r.linkCandidates(db, p.id, 'issue', 'APP-1').map((c) => c.title), ['登录页'])
  assert.deepEqual(r.linkCandidates(db, p.id, 'decision', '框架').map((c) => c.code), ['D-1'])
  assert.deepEqual(r.linkCandidates(db, p.id, 'folder'), [])

  r.unlinkSession(db, 's', 'folder', shared)
  assert.deepEqual(r.sessionContext(db, 's').dirs, [lib])
  assert.deepEqual(r.sessionContext(db, 'other'), { dirs: [], text: '' })
})

test('迁移可重复执行；和底座的表共存', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'soloyard-')), 'monocode.db')
  const base = new DatabaseSync(file)
  base.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, harness TEXT, updated_at INTEGER); INSERT INTO sessions VALUES ('s1', '修登录', 'claude', 1)")
  base.close()
  const db = openDb(file)
  const p = r.projectForPath(db, '/x')
  const id = r.createIssue(db, 'user', p.id, { title: 't' })
  r.linkSession(db, 's1', 'issue', String(id))
  r.linkSession(db, 'gone', 'issue', String(id))
  db.close()
  const again = openDb(file) // 第二次打开不重复建表
  const sessions = r.getIssue(again, id)!.sessions
  assert.equal(sessions.find((s) => s.id === 's1')!.title, '修登录')
  assert.equal(sessions.find((s) => s.id === 'gone')!.missing, true)
})

test('sidecar：请求 / 回应 / 写后广播 changed / 版本冲突带 latest', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'soloyard-')), 'monocode.db')
  const child = spawn(process.execPath, [join(import.meta.dirname, '../src/sidecar.ts'), file], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines: any[] = []
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i)))
  })
  const call = (id: number, method: string, ...args: unknown[]) => {
    child.stdin.write(JSON.stringify({ id, method, args }) + '\n')
    return new Promise<any>((resolve) => {
      const t = setInterval(() => {
        const hit = lines.find((l) => l.id === id)
        if (hit) { clearInterval(t); resolve(hit) }
      }, 10)
    })
  }
  const p = (await call(1, 'projectForPath', '/x/demo')).result
  const issueId = (await call(2, 'createIssue', p.id, { title: '第一个' })).result
  assert.equal((await call(3, 'listIssues', { projectId: p.id })).result[0].ident, 'DEM-1')
  assert.ok(lines.some((l) => l.event === 'changed'))
  const conflict = await call(4, 'updateIssue', issueId, { title: 'x' }, 99)
  assert.match(conflict.error, /version conflict/)
  assert.equal(conflict.latest.version, 1)
  assert.match((await call(5, 'dropTables')).error, /unknown method/)
  child.stdin.end()
})

test('导入原型库：整体搬项目、id 重新编号、迭代 → cycle、重复导入跳过；父目录不吞子目录', async () => {
  const { importLegacy } = await import('../src/import-legacy.ts')
  const dir = mkdtempSync(join(tmpdir(), 'soloyard-legacy-'))
  const legacy = new DatabaseSync(join(dir, 'indie-desk.db'))
  legacy.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, key TEXT, name TEXT, goal TEXT, stage TEXT, archived INTEGER, next_step TEXT, stoploss_json TEXT, meta_json TEXT, issue_seq INTEGER, created_at TEXT, updated_at TEXT, version INTEGER);
    CREATE TABLE project_paths (project_id INTEGER, path TEXT, recursive INTEGER);
    CREATE TABLE iterations (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, start_date TEXT, end_date TEXT, status TEXT, created_at TEXT, updated_at TEXT, version INTEGER);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY, project_id INTEGER, code TEXT, title TEXT, door TEXT, status TEXT, data_json TEXT, created_at TEXT, updated_at TEXT, version INTEGER);
    CREATE TABLE issues (id INTEGER PRIMARY KEY, project_id INTEGER, number INTEGER, title TEXT, body_md TEXT, status TEXT, priority INTEGER, labels TEXT, due_date TEXT, iteration_id INTEGER, milestone_id INTEGER, parent_id INTEGER, feature_id INTEGER, sort_key REAL, completed_at TEXT, created_at TEXT, updated_at TEXT, version INTEGER);
    CREATE TABLE issue_deps (issue_id INTEGER, blocked_by_id INTEGER);
    CREATE TABLE acceptance (id INTEGER PRIMARY KEY, issue_id INTEGER, text TEXT, done INTEGER, sort INTEGER);
    INSERT INTO projects VALUES (7, 'IND', 'indie-desk', '', 'active', 0, '', NULL, NULL, 2, 't', 't', 3);
    INSERT INTO project_paths VALUES (7, '/home/play', 0);
    INSERT INTO iterations VALUES (4, 7, '迭代 1', NULL, NULL, 'active', 't', 't', 1);
    INSERT INTO decisions VALUES (1, 7, 'D-1', '做不做', 'one-way', 'decided', '{"user":{"option":"A"}}', 't', 't', 1);
    INSERT INTO issues VALUES (20, 7, 2, '子', '', 'todo', 0, '[]', NULL, NULL, NULL, 21, NULL, 1, NULL, 't', 't', 1);
    INSERT INTO issues VALUES (21, 7, 1, '父', '', 'in_progress', 2, '["mvp"]', NULL, 4, NULL, NULL, NULL, 0, NULL, 't', 't', 1);
    INSERT INTO issue_deps VALUES (20, 21);
    INSERT INTO acceptance VALUES (1, 21, '能跑', 1, 0);
  `)
  legacy.close()
  const db = openDb(':memory:')
  r.createProject(db, 'user', { name: 'Soloyard', key: 'SOL', path: '/home/play/soloyard' })
  const first = importLegacy(db, join(dir, 'indie-desk.db'))
  assert.equal(first.counts.issues, 2)
  const ind = r.findProject(db, 'IND')!
  const issues = r.listIssues(db, { projectId: ind.id, includeSubIssues: true })
  const parent = issues.find((i) => i.title === '父')!
  const child = issues.find((i) => i.title === '子')!
  assert.equal(child.parent_id, parent.id)
  assert.equal(parent.ident, 'IND-1')
  assert.ok(parent.cycle_id)
  assert.deepEqual(r.getIssue(db, child.id)!.blockedBy.map((b) => b.id), [parent.id])
  assert.equal(r.getIssue(db, parent.id)!.acceptance[0].text, '能跑')
  assert.deepEqual(importLegacy(db, join(dir, 'indie-desk.db')).skipped, ['IND'], '重复导入跳过')
  assert.equal(r.findProjectByPath(db, '/home/play/soloyard/src')!.key, 'SOL', '子项目归自己')
  assert.equal(r.findProjectByPath(db, '/home/play')!.key, 'IND')
  assert.equal(r.findProjectByPath(db, '/home/play/other'), undefined, '不含子目录的父目录不吞子目录')
})
