import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { startGateway } from '../../host/gateway.ts'
import { collect, pushOnce, type Pushed } from '../src/mirror.ts'

/** 上游 sessions 表里会用到的列（真实表还有别的列，这里不需要）。 */
function desktopDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL,
    model_settings TEXT, runtime_mode TEXT NOT NULL, title TEXT NOT NULL, provider_session_id TEXT, blocks_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, branch TEXT, worktree_cwd TEXT, archived INTEGER DEFAULT 0,
    is_draft INTEGER DEFAULT 0, sidebar_hidden INTEGER DEFAULT 0, inbox_ask TEXT, has_user_message INTEGER DEFAULT 1)`)
  return db
}
const add = (db: DatabaseSync, id: string, cwd: string, updatedAt: number, extra: Record<string, unknown> = {}) => {
  const row = { id, cwd, harness: 'claude', model: 'claude:opus', model_settings: '{}', runtime_mode: 'supervised', title: `会话 ${id}`,
    provider_session_id: `p-${id}`, blocks_json: JSON.stringify([{ id: 'b', role: 'user', text: id }]), created_at: updatedAt, updated_at: updatedAt, ...extra }
  db.prepare(`INSERT INTO sessions (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`).run(...(Object.values(row) as never[]))
}

test('电脑推会话镜像：只推该推的、变了再推、归档和删除通知网关，手机按主机路径查得到', async (t) => {
  // 同一个仓库：电脑上一份、主机上一份，路径不同、origin 相同
  const repo = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), name))
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:me/openroboto.git'])
    return dir
  }
  const onMac = repo('mac-openroboto-')
  const onHost = repo('host-openroboto-')

  const dataDir = mkdtempSync(join(tmpdir(), 'soloyard-gateway-'))
  writeFileSync(join(dataDir, 'host-device.json'), JSON.stringify({ token: 'h'.repeat(43) }))
  const { server, store, url } = await startGateway({ dataDir, listen: '127.0.0.1:0' })
  t.after(() => server.close())
  const desktop = store.pair('MacBook', 'desktop')
  const config = { url, token: desktop.token, machine: 'MacBook' }

  const db = desktopDb()
  const now = Date.now()
  add(db, 'a', onMac, now - 1000)
  add(db, 'b', onMac, now - 2000, { archived: 1 })
  add(db, 'c', onMac, now - 3000, { is_draft: 1 })
  add(db, 'old', onMac, now - 30 * 86_400_000)
  const pushed: Pushed = new Map()

  assert.deepEqual(await pushOnce(db, config, pushed), { stored: 1, removed: 0 }, '归档、草稿、一个月前的不推')
  assert.deepEqual(collect(db, pushed), { sessions: [], removed: [] }, '没变就不再推')

  const list = store.list((await import('../src/repokey.ts')).repoKey(onHost))
  assert.deepEqual(list.map((s) => s.id), ['a'], '手机拿主机上的路径也查得到电脑上的会话')
  assert.equal(store.get('a').session.blocks[0].text, 'a')

  db.prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?').run(now, '改了名', 'a')
  assert.deepEqual(await pushOnce(db, config, pushed), { stored: 1, removed: 0 })
  assert.equal(store.list('github.com/me/openroboto')[0].title, '改了名')

  db.prepare('UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?').run(now + 1, 'a')
  assert.deepEqual(await pushOnce(db, config, pushed), { stored: 0, removed: 1 }, '归档了就从手机上拿掉')
  assert.equal(store.list('github.com/me/openroboto').length, 0)

  add(db, 'd', onMac, now)
  await pushOnce(db, config, pushed)
  db.prepare('DELETE FROM sessions WHERE id = ?').run('d')
  assert.deepEqual(await pushOnce(db, config, pushed), { stored: 0, removed: 1 }, '删掉了也从手机上拿掉')
})

test('迁移号被别的分支占了的库也能用：启动时自己建表', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { ensureTables, syncStatus } = await import('../src/mirror.ts')
  const db = new DatabaseSync(':memory:')
  assert.throws(() => syncStatus(db))
  ensureTables(db)
  ensureTables(db) // 再建一次不出错
  assert.equal(syncStatus(db).connected, false)
})
