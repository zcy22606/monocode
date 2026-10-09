import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../../core/src/db.ts'
import * as repo from '../../core/src/repo.ts'

/** 起一个 MCP 服务进程，按 JSON-RPC 收发。 */
function server(dbPath: string) {
  const child = spawn(process.execPath, ['--no-warnings', join(import.meta.dirname, '../server.ts')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SOLOYARD_DB: dbPath, SOLOYARD_ACTOR: 'agent:test' },
  })
  const replies = new Map<number, any>()
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const msg = JSON.parse(buf.slice(0, i))
      replies.set(msg.id, msg)
    }
  })
  let next = 1
  const rpc = (method: string, params?: unknown) => {
    const id = next++
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return new Promise<any>((resolve) => {
      const t = setInterval(() => {
        if (replies.has(id)) { clearInterval(t); resolve(replies.get(id)) }
      }, 5)
    })
  }
  const tool = async (name: string, args: unknown) => {
    const r = (await rpc('tools/call', { name, arguments: args })).result
    return { error: r.isError ? JSON.parse(r.content[0].text) : undefined, data: r.isError ? undefined : JSON.parse(r.content[0].text) }
  }
  return { rpc, tool, close: () => child.stdin.end() }
}

test('MCP：握手、按目录 / worktree 找项目、建 / 改 issue、不许 agent 改 done、版本冲突', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const repoDir = join(dir, 'app')
  execFileSync('git', ['init', '-q', repoDir])
  execFileSync('git', ['-C', repoDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  const worktree = join(dir, 'app-worktrees', 'feature')
  execFileSync('git', ['-C', repoDir, 'worktree', 'add', '-q', '-b', 'feature', worktree])
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  const pid = repo.createProject(db, 'user', { name: 'App', key: 'APP', path: repoDir })
  db.close()

  const s = server(dbPath)
  try {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.equal(init.result.serverInfo.name, 'soloyard')
    assert.match(init.result.instructions, /in_review/)
    const tools = (await s.rpc('tools/list')).result.tools.map((t: any) => t.name)
    assert.ok(tools.includes('update_issue') && tools.includes('create_issues'))

    assert.equal((await s.tool('get_project', { project: join(repoDir, 'src') })).data.id, pid, '子目录归到项目')
    assert.equal((await s.tool('get_project', { project: worktree })).data.id, pid, 'worktree 归到主仓库的项目')
    assert.match((await s.tool('get_project', { project: '/nowhere' })).error.error, /找不到项目/)

    const created = (await s.tool('create_issues', { project: 'APP', issues: [{ title: 'A', acceptance: ['能跑'] }, { title: 'B', blocked_by: ['APP-1'] }] })).data
    assert.deepEqual(created.map((i: any) => i.ident), ['APP-1', 'APP-2'])
    assert.match((await s.tool('update_issue', { issue: 'APP-1', status: 'done' })).error.error, /不能由 agent 改成 done/)
    const reviewed = (await s.tool('update_issue', { issue: 'APP-1', status: 'in_review' })).data
    assert.equal(reviewed.status, 'in_review')
    await s.tool('add_comment', { issue: 'APP-1', body_md: '跑了 npm test，全过' })
    const conflict = (await s.tool('update_issue', { issue: 'APP-2', title: 'x', expected_version: 99 })).error
    assert.match(conflict.error, /version_conflict/)
    assert.equal(conflict.latest.version, 1)
    await s.tool('create_issues', { project: 'APP', issues: [{ title: 'C', priority: 3 }, { title: 'D', priority: 1 }, { title: 'E', priority: 3 }] })
    const ranked = (await s.tool('list_issues', { project: 'APP' })).data
    assert.deepEqual(ranked.map((i: any) => i.title), ['D', 'C', 'E', 'A', 'B'], '紧急 → 低，同优先级按原顺序，无优先级最后')
    assert.deepEqual((await s.tool('list_issues', { project: 'APP', priority: [3, 0] })).data.map((i: any) => i.title), ['C', 'E', 'A', 'B'])
    const detail = (await s.tool('get_issue', { issue: 'APP-1' })).data
    assert.equal(detail.comments[0].actor, 'agent:test')
    assert.equal(detail.acceptance[0].text, '能跑')
  } finally {
    s.close() // 断言失败也要关掉子进程，否则测试一直等它退出
  }
})

test('MCP：迭代表、建迭代、建功能、挪功能；不许 agent 标「不做」或挪进已完成的迭代', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app') })
  db.close()

  const s = server(dbPath)
  try {
    assert.equal((await s.tool('create_iteration', { project: 'APP', tag: 'v1.0', name: 'MVP' })).data.tag, 'v1.0')
    await s.tool('create_iteration', { project: 'APP', tag: 'v0.1', before: 'v1.0' })
    assert.match((await s.tool('create_iteration', { project: 'APP', tag: '1.0' })).error.error, /已经有了/)

    const created = (await s.tool('create_features', { project: 'APP', to: 'v1.0', features: [{ name: '登录' }, { name: '导出' }] })).data
    assert.deepEqual(created.map((f: any) => f.code), ['F-001', 'F-002'])
    assert.match((await s.tool('move_features', { project: 'APP', codes: ['F-002'], to: 'cut' })).error.error, /不做/)
    assert.equal((await s.tool('move_features', { project: 'APP', codes: ['F-002'], to: 'v0.1' })).data.moved, 1)

    const plan = (await s.tool('get_iteration_plan', { project: 'APP' })).data
    assert.deepEqual(plan.iterations.map((i: any) => [i.tag, i.features]), [['v0.1', 1], ['v1.0', 1]])
    assert.deepEqual((await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v1.0' })).data.map((f: any) => f.name), ['登录'])
    assert.deepEqual((await s.tool('get_iteration_plan', { project: 'APP', moved: true })).data, [], 'agent 建的功能没有 AI 安排，不算挪过')

    // 用户在应用里完成了 v0.1：锁定后 agent 也挪不进去
    const db2 = openDb(dbPath)
    const v01 = db2.prepare("SELECT id FROM soloyard_iterations WHERE tag = 'v0.1'").get() as { id: number }
    db2.prepare("UPDATE soloyard_iterations SET status = 'done' WHERE id = ?").run(v01.id)
    db2.close()
    assert.match((await s.tool('move_features', { project: 'APP', codes: ['F-001'], to: 'v0.1' })).error.error, /锁定/)
  } finally {
    s.close()
  }
})

test('MCP：改迭代（版本号 / 名称 / 先后）、只删空迭代、update_issue 把 issue 排进迭代', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app') })
  db.close()

  const s = server(dbPath)
  try {
    await s.tool('create_iteration', { project: 'APP', tag: 'v0.1' })
    await s.tool('create_iteration', { project: 'APP', tag: 'v0.2' })
    await s.tool('create_features', { project: 'APP', to: 'v0.1', features: [{ name: '登录' }] })
    // 旧的 v0.1 改成 v0.2 前先删掉空的 v0.2，再新建 v0.1 排到它前面
    assert.match((await s.tool('update_iteration', { project: 'APP', iteration: 'v0.1', tag: 'v0.2' })).error.error, /已经有了/)
    assert.match((await s.tool('delete_iteration', { project: 'APP', iteration: 'v0.1' })).error.error, /只能删空迭代/)
    assert.equal((await s.tool('delete_iteration', { project: 'APP', iteration: 'v0.2' })).data.deleted, 'v0.2')
    assert.equal((await s.tool('update_iteration', { project: 'APP', iteration: 'v0.1', tag: 'v0.2', name: '旧骨架' })).data.name, '旧骨架')
    await s.tool('create_iteration', { project: 'APP', tag: 'v0.1' })
    await s.tool('update_iteration', { project: 'APP', iteration: 'v0.1', before: 'v0.2' })
    const plan = (await s.tool('get_iteration_plan', { project: 'APP' })).data
    assert.deepEqual(plan.iterations.map((i: any) => [i.tag, i.features]), [['v0.1', 0], ['v0.2', 1]])

    // 没挂功能的 issue：排进迭代时用标题建功能挂上；再排一次只挪功能
    const [loose] = (await s.tool('create_issues', { project: 'APP', issues: [{ title: '修崩溃', priority: 2 }] })).data
    assert.equal((await s.tool('update_issue', { issue: loose.ident, iteration: 'v0.1', priority: 3 })).data.priority, 3)
    assert.deepEqual((await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v0.1' })).data.map((f: any) => [f.name, f.issue]), [['修崩溃', `${loose.ident} (backlog)`]])
    await s.tool('update_issue', { issue: loose.ident, iteration: 'v0.2' })
    assert.deepEqual((await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v0.2' })).data.map((f: any) => f.name), ['登录', '修崩溃'])
    assert.match((await s.tool('update_issue', { issue: loose.ident, iteration: 'cut' })).error.error, /不做/)

    // create_issues：上面建「修崩溃」时没有进行中的迭代，自动建了「未命名迭代」；之后默认都进它，传 iteration 放到指定的
    const unnamed = (await s.tool('get_iteration_plan', { project: 'APP' })).data.iterations.find((i: any) => i.name === '未命名迭代')
    assert.deepEqual([unnamed.tag, unnamed.status], ['v0.3', 'active'])
    const [cur] = (await s.tool('create_issues', { project: 'APP', issues: [{ title: '默认' }] })).data
    const [later] = (await s.tool('create_issues', { project: 'APP', iteration: 'v0.1', issues: [{ title: '指定' }] })).data
    const [parked] = (await s.tool('create_issues', { project: 'APP', iteration: 'pending', issues: [{ title: '待定的' }] })).data
    assert.equal(parked.title, '待定的', '放到待定的也返回')
    assert.ok((await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v0.3' })).data.some((f: any) => f.issue?.startsWith(cur.ident)))
    assert.ok((await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v0.1' })).data.some((f: any) => f.issue?.startsWith(later.ident)))
  } finally {
    s.close()
  }
})

test('MCP：按功能编号建 issue，迭代表显示它的状态；已有就返回现有的；编号不存在报错', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app') })
  db.close()

  const s = server(dbPath)
  try {
    await s.tool('create_iteration', { project: 'APP', tag: 'v1.0' })
    await s.tool('create_features', { project: 'APP', to: 'v1.0', features: [{ name: '登录' }, { name: '导出' }] })

    const first = (await s.tool('create_feature_issues', { project: 'APP', codes: ['F-001'] })).data
    assert.deepEqual(first, [{ feature: 'F-001', ident: 'APP-1', title: '登录', status: 'todo', existing: false }])
    await s.tool('update_issue', { issue: 'APP-1', status: 'in_review' })
    const again = (await s.tool('create_feature_issues', { project: 'APP', codes: ['F-001', 'F-002'] })).data
    assert.deepEqual(again.map((i: any) => [i.feature, i.ident, i.existing]), [['F-001', 'APP-1', true], ['F-002', 'APP-2', false]])

    const v1 = (await s.tool('get_iteration_plan', { project: 'APP', iteration: 'v1.0' })).data
    assert.deepEqual(v1.map((f: any) => [f.code, f.issue]), [['F-001', 'APP-1 (in_review)'], ['F-002', 'APP-2 (todo)']])
    const listed = (await s.tool('list_issues', { project: 'APP' })).data
    assert.equal(listed.length, 2, '挂在迭代功能上的 issue 出现在 Issues 列表里')

    assert.match((await s.tool('create_feature_issues', { project: 'APP', codes: ['F-002', 'NOPE-9'] })).error.error, /找不到功能 NOPE-9/)
    assert.equal((await s.tool('list_issues', { project: 'APP' })).data.length, 2, '报错时整批不建')
  } finally {
    s.close()
  }
})

test('agent 经 MCP 建的 issue，界面的数据进程 1 秒内广播 changed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'soloyard-live-'))
  const file = join(dir, 'monocode.db')
  const db = openDb(file)
  repo.createProject(db, 'user', { name: 'Live', key: 'LIV', path: dir })
  const sidecar = spawn(process.execPath, [join(import.meta.dirname, '../../core/src/sidecar.ts'), file], { stdio: ['pipe', 'pipe', 'inherit'] })
  let changedAt = 0
  sidecar.stdout.on('data', (d) => { if (String(d).includes('"changed"')) changedAt ||= performance.now() })
  const s = server(file)
  try {
    await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    await new Promise((r) => setTimeout(r, 300)) // 等数据进程起来、记下初始版本
    const start = performance.now()
    assert.ok((await s.tool('create_issues', { project: 'LIV', issues: [{ title: 'from agent' }] })).data)
    while (!changedAt && performance.now() - start < 2000) await new Promise((r) => setTimeout(r, 10))
    assert.ok(changedAt, 'no changed event')
    t.diagnostic(`latency ${Math.round(changedAt - start)}ms`)
    assert.ok(changedAt - start < 1000, `took ${Math.round(changedAt - start)}ms`)
  } finally {
    s.close()
    sidecar.stdin.end()
    db.close()
  }
})

test('MCP：多仓库项目里建 issue 标仓库（名字或路径），get_project 列仓库，list_issues 带仓库名，update_issue 能改回根目录', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-repos-')))
  for (const name of ['backend', 'web']) execFileSync('git', ['init', '-q', join(dir, name)])
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  const pid = repo.createProject(db, 'user', { name: 'Ws', key: 'WS', path: dir })
  for (const name of ['backend', 'web']) db.prepare('INSERT INTO soloyard_project_repos (project_id, path) VALUES (?, ?)').run(pid, join(dir, name))
  db.close()

  const s = server(dbPath)
  try {
    const project = (await s.tool('get_project', { project: join(dir, 'backend', 'src') })).data
    assert.equal(project.key, 'WS')
    assert.deepEqual(project.repos.map((r: any) => r.name), ['backend', 'web'])
    const created = (await s.tool('create_issues', { project: 'WS', issues: [
      { title: '改协议' },
      { title: '后端接新协议', repo: 'backend', parent: 'WS-1' },
      { title: '前端接新协议', repo: join(dir, 'web'), parent: 'WS-1', blocked_by: ['WS-2'] },
    ] })).data
    assert.deepEqual(created.map((i: any) => i.ident), ['WS-1', 'WS-2', 'WS-3'])
    assert.equal((await s.tool('get_issue', { issue: 'WS-2' })).data.repo_path, join(dir, 'backend'))
    const ready = (await s.tool('list_issues', { project: 'WS' })).data
    assert.deepEqual(ready.map((i: any) => [i.ident, i.repo ?? null]), [['WS-1', null]], 'sub-issues stay under their parent')
    const bad = await s.tool('create_issues', { project: 'WS', issues: [{ title: 'x', repo: 'nope' }] })
    assert.match(bad.error.message ?? bad.error.error ?? JSON.stringify(bad.error), /没有仓库「nope」/)
    await s.tool('update_issue', { issue: 'WS-2', repo: '' })
    assert.equal((await s.tool('get_issue', { issue: 'WS-2' })).data.repo_path, null)
  } finally {
    s.close()
  }
})
