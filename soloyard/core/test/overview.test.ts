import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { getOverview, overviewSummary, updateOverview, OverviewConflict } from '../src/overview.ts'
import { projectSessionContext } from '../src/repos.ts'

test('overview：按节改、带版本；用户改过的 agent 不能覆盖；字段同步到项目；写快照', () => {
  const db = openDb(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'soloyard-overview-'))
  const pid = r.createProject(db, 'user', { name: '未命名想法', path: root, stage: 'idea' })
  const entry = (k: string) => getOverview(db, pid).entries.find((e) => e.key === k)!

  assert.deepEqual([entry('name').body, entry('name').version], ['未命名想法', 0], '没写过时用项目本身的名称')
  updateOverview(db, 'agent:claude', pid, [
    { key: 'name', body: '小红书新手复盘助手', expected_version: 0 },
    { key: 'slug', body: 'xhs-coach', expected_version: 0 },
    { key: 'goal', body: '帮新手复盘每篇数据', expected_version: 0 },
    { key: 'background', body: '新手不知道问题在哪（E-1）', expected_version: 0 },
  ])
  const p = r.getRow(db, 'projects', pid)!
  assert.deepEqual([p.name, p.slug, p.goal], ['小红书新手复盘助手', 'xhs-coach', '帮新手复盘每篇数据'])
  assert.equal(entry('background').updated_by, 'agent:claude')

  // 用户改了这一节；agent 拿旧版本来改 → 拒绝，并告诉它是用户改的
  updateOverview(db, 'user', pid, [{ key: 'background', body: '我改过的背景', expected_version: 1 }])
  assert.throws(() => updateOverview(db, 'agent:claude', pid, [{ key: 'background', body: '覆盖', expected_version: 1 }]), (e: unknown) =>
    e instanceof OverviewConflict && /用户/.test(e.message) && e.latest.body === '我改过的背景')
  // 一次里有一节冲突，整批都不写
  assert.throws(() => updateOverview(db, 'agent:claude', pid, [{ key: 'users', body: 'x', expected_version: 0 }, { key: 'background', body: 'y', expected_version: 1 }]))
  assert.equal(entry('users').version, 0)

  assert.throws(() => updateOverview(db, 'agent:claude', pid, [{ key: 'slug', body: 'XHS Coach', expected_version: 1 }]), /英文名/)
  assert.throws(() => updateOverview(db, 'agent:claude', pid, [{ key: 'nope', body: 'x' }]), /没有/)

  const snap = readFileSync(join(root, 'docs', 'overview.md'), 'utf8')
  assert.match(snap, /^<!-- Soloyard 自动生成/)
  assert.match(snap, /# 小红书新手复盘助手/)
  assert.match(snap, /## 背景与问题\n\n我改过的背景/)
})

test('系统提示摘要：没写过 overview 就没有；写了就接在项目地图后面', () => {
  const db = openDb(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'soloyard-overview-'))
  const pid = r.createProject(db, 'user', { name: 'App', key: 'APP', path: root })
  assert.equal(overviewSummary(db, pid), '')
  assert.equal(projectSessionContext(db, root).map, '')

  updateOverview(db, 'agent:x', pid, [{ key: 'goal', body: '一句话', expected_version: 0 }])
  r.insert(db, 'agent:x', 'decisions', { project_id: pid, code: 'D-2', title: '首要人群', door: 'one-way', status: 'decided' })
  const map = projectSessionContext(db, root).map
  assert.match(map, /# Soloyard project: App \(issue key APP\)/)
  assert.match(map, /One-liner: 一句话/)
  assert.match(map, /Decided: D-2 首要人群/)
  assert.match(map, /get_overview/)
})
