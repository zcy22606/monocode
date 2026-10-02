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
    const detail = (await s.tool('get_issue', { issue: 'APP-1' })).data
    assert.equal(detail.comments[0].actor, 'agent:test')
    assert.equal(detail.acceptance[0].text, '能跑')
  } finally {
    s.close() // 断言失败也要关掉子进程，否则测试一直等它退出
  }
})
