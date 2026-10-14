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

test('MCP：get_project / list_projects 带阶段和下一步；update_project 改阶段要原因', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app'), stage: 'initiating' })
  db.close()

  const s = server(dbPath)
  try {
    const p = (await s.tool('get_project', { project: 'APP' })).data
    assert.deepEqual([p.stage, p.stage_step], ['initiating', 'charter'])
    assert.match(p.next_step, /立项覆盖表/)
    assert.equal((await s.tool('list_projects', {})).data[0].stage, 'initiating')
    assert.match((await s.tool('update_project', { project: 'APP', stage: 'launched', reason: '上线了' })).error.error, /建造期/)
    const parked = (await s.tool('update_project', { project: 'APP', stage: 'parked', reason: '先做别的' })).data
    assert.deepEqual([parked.stage, parked.stage_note.reason, parked.stage_note.by], ['parked', '先做别的', 'agent:test'])
    assert.equal((await s.tool('update_project', { project: 'APP', stage: 'resume', reason: '回来做' })).data.stage, 'initiating')
  } finally {
    s.close()
  }
})

test('MCP：get_overview / update_overview，用户改过的节不覆盖', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app') })
  db.close()

  const s = server(dbPath)
  try {
    const before = (await s.tool('get_overview', { project: 'APP' })).data
    assert.equal(before.entries.length, 13)
    const res = (await s.tool('update_overview', { project: 'APP', updates: [{ key: 'goal', body: '一句话', expected_version: 0 }, { key: 'users', body: '独立开发者', expected_version: 0 }] })).data
    assert.deepEqual(res, [{ key: 'goal', version: 1 }, { key: 'users', version: 1 }])

    const db2 = openDb(dbPath)
    const { updateOverview } = await import('../../core/src/overview.ts')
    updateOverview(db2, 'user', 1, [{ key: 'users', body: '我改的', expected_version: 1 }])
    db2.close()
    const err = (await s.tool('update_overview', { project: 'APP', updates: [{ key: 'users', body: '覆盖', expected_version: 1 }] })).error
    assert.match(err.error, /用户在你读过之后改过「目标用户」/)
    assert.equal(err.latest.body, '我改的')
    assert.equal((await s.tool('get_project', { project: 'APP' })).data.goal, '一句话')
  } finally {
    s.close()
  }
})

test('MCP：决策和证据；record_decision 要原话；单向门定了阶段往下走', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-')))
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  repo.createProject(db, 'user', { name: 'App', key: 'APP', path: join(dir, 'app'), stage: 'initiating' })
  repo.insert(db, 'user', 'documents', { project_id: 1, slug: '01-立项', title: '立项卡', body_md: '' })
  db.close()

  const s = server(dbPath)
  try {
    const { codes } = (await s.tool('add_evidence', { project: 'APP', items: [{ claim: '新手看不懂数据', level: 'B' }] })).data
    assert.deepEqual(codes, ['E-1'])
    await s.tool('upsert_decisions', { project: 'APP', decisions: [{ code: 'D-2', title: '首要人群', door: 'one-way', options: [{ key: 'A', label: '新手' }, { key: 'B', label: '腰部' }], evidence: codes }] })
    assert.equal((await s.tool('get_project', { project: 'APP' })).data.stage_step, 'decide')
    assert.match((await s.tool('record_decision', { project: 'APP', code: 'D-2', option: 'A', quote: '' })).error.error, /原话/)
    const rec = (await s.tool('record_decision', { project: 'APP', code: 'D-2', option: 'A', quote: '就先做新手' })).data
    assert.deepEqual([rec.status, rec.user.via, rec.user.quote], ['decided', '对话', '就先做新手'])
    assert.deepEqual((await s.tool('list_decisions', { project: 'APP' })).data, [{ code: 'D-2', title: '首要人群', door: 'one-way', status: 'decided', user: { option: 'A', via: '对话', date: rec.user.date } }])
    assert.equal((await s.tool('get_project', { project: 'APP' })).data.stage_step, 'versions')
    assert.equal((await s.tool('list_evidence', { project: 'APP', codes: ['E-1'] })).data[0].claim, '新手看不懂数据')
  } finally {
    s.close()
  }
})

test('MCP：new_doc 按规范建文档（编号续上、作者是 agent），list_docs 列根目录和成员仓库的文档', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-mcp-docs-')))
  const backend = join(dir, 'backend')
  execFileSync('git', ['init', '-q', backend])
  const dbPath = join(dir, 'monocode.db')
  const db = openDb(dbPath)
  const pid = repo.createProject(db, 'user', { name: 'Robo', key: 'ROB', path: dir })
  db.prepare('INSERT INTO soloyard_project_repos (project_id, path, description, sort) VALUES (?, ?, ?, 0)').run(pid, backend, '后端')
  db.close()

  const s = server(dbPath)
  try {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.match(init.result.instructions, /NN-中文标题\.md/, 'instructions 里带着文档规范')
    const adr = await s.tool('new_doc', { project: 'ROB', type: 'adr', title: '提交费按赛事配置', repo: 'backend', related: 'ROB-1' })
    assert.equal(adr.data.code, 'adr/01')
    assert.equal(adr.data.path, join(backend, 'docs', 'adr', '01-提交费按赛事配置.md'))
    assert.equal((await s.tool('new_doc', { project: 'ROB', type: 'product', title: '立项卡', kind: 'json' })).data.path, join(dir, 'docs', 'product', '01-立项卡.json'))
    assert.match((await s.tool('new_doc', { project: 'ROB', type: 'notes', title: 'x' })).error.error, /类型只能是/)

    const all = (await s.tool('list_docs', { project: 'ROB' })).data
    assert.deepEqual(all.map((d: any) => [d.code, d.title, d.repo, d.status]), [['product/01', '立项卡', null, '草稿'], ['adr/01', 'ADR 01：提交费按赛事配置', 'backend', '草稿']])
    assert.deepEqual((await s.tool('list_docs', { project: dir, q: '提交费' })).data.map((d: any) => d.code), ['adr/01'])
    const { readFileSync } = await import('node:fs')
    assert.match(readFileSync(adr.data.path, 'utf8'), /- 作者：test\n- 关联：ROB-1/)
  } finally {
    s.close()
  }
})
