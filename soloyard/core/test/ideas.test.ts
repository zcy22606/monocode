import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { backfillIdeas, checkPromote, deleteIdea, ideaForPath, ideasUnder, moveIdeaPath, promoteIdea, setProjectKey, suggestKey } from '../src/ideas.ts'
import { getOverview, updateOverview } from '../src/overview.ts'
import { projectStage } from '../src/stage.ts'

test('想法项目：头脑风暴文件夹一个一条；补建；改名跟路径；删除只删想法期的', () => {
  const db = openDb(':memory:')
  const ws = mkdtempSync(join(tmpdir(), 'soloyard-ws-'))
  mkdirSync(join(ws, '2026-10-07-1714'))
  mkdirSync(join(ws, '2026-10-09-1433'))
  assert.equal(backfillIdeas(db, ws), 2)
  assert.equal(backfillIdeas(db, ws), 0, '已经有的不重复建')

  const a = ideaForPath(db, 'user', join(ws, '2026-10-07-1714/'))
  assert.equal(ideaForPath(db, 'user', join(ws, '2026-10-07-1714')).id, a.id)
  assert.deepEqual([a.stage, a.name, a.key.startsWith('~')], ['idea', '', true])
  assert.equal(projectStage(db, a.id).stage, 'idea')
  assert.equal(r.findProjectByPath(db, join(ws, '2026-10-07-1714'))?.id, a.id, 'MCP 按工作文件夹能找到')

  moveIdeaPath(db, join(ws, '2026-10-07-1714'), join(ws, 'xhs'))
  assert.deepEqual(ideasUnder(db, ws).map((i) => i.path).sort(), [join(ws, '2026-10-09-1433'), join(ws, 'xhs')])

  deleteIdea(db, 'user', join(ws, 'xhs'))
  assert.equal(ideasUnder(db, ws).length, 1)
})

test('提升为项目：检查、换文件夹、填前缀、阶段变立项，overview 不丢，快照写到新文件夹', () => {
  const db = openDb(':memory:')
  const ws = mkdtempSync(join(tmpdir(), 'soloyard-ws-'))
  const folder = join(ws, '2026-10-12-1000')
  mkdirSync(folder)
  const idea = ideaForPath(db, 'user', folder)
  updateOverview(db, 'agent:claude', idea.id, [
    { key: 'name', body: '小红书新手复盘助手', expected_version: 0 },
    { key: 'slug', body: 'xhs-coach', expected_version: 0 },
    { key: 'background', body: '新手不知道问题在哪', expected_version: 0 },
  ])
  r.createProject(db, 'user', { name: 'Other', key: 'XC', path: '/work/other' })
  assert.equal(suggestKey(db, 'xhs-coach'), 'XC2', '首字母，冲突加数字')
  assert.equal(suggestKey(db, 'soloyard'), 'SOL')

  const input = { name: '小红书新手复盘助手', slug: 'xhs-coach', key: 'XHS', goal: '帮新手复盘每篇数据' }
  assert.match(checkPromote(db, folder, { ...input, key: 'XC' })!, /已经被别的项目用了/)
  assert.match(checkPromote(db, folder, { ...input, slug: 'XHS Coach' })!, /英文名/)
  const target = join(mkdtempSync(join(tmpdir(), 'soloyard-dst-')), 'xhs-coach')
  mkdirSync(target)
  writeFileSync(join(target, 'x'), '')
  assert.match(checkPromote(db, folder, { ...input, path: target })!, /不是空的/)
  assert.equal(checkPromote(db, folder, input), null)

  const empty = join(target, '..', 'xhs-coach-2')
  mkdirSync(empty)
  const p = promoteIdea(db, 'user', folder, { ...input, path: empty })
  assert.deepEqual([p.key, p.stage, p.name, p.slug, p.goal], ['XHS', 'initiating', '小红书新手复盘助手', 'xhs-coach', '帮新手复盘每篇数据'])
  assert.equal(r.findProjectByPath(db, empty)?.id, idea.id)
  assert.equal(ideasUnder(db, ws).length, 0, '提升后不在头脑风暴列表里')
  assert.equal(getOverview(db, idea.id).entries.find((e) => e.key === 'background')!.body, '新手不知道问题在哪')
  assert.match(readFileSync(join(empty, 'docs', 'overview.md'), 'utf8'), /# 小红书新手复盘助手/)
  assert.deepEqual([projectStage(db, idea.id).stage, projectStage(db, idea.id).step], ['initiating', 'charter'])
  assert.match(checkPromote(db, empty, input)!, /找不到|提升过/)

  deleteIdea(db, 'user', empty)
  assert.ok(r.getRow(db, 'projects', idea.id), '提升过的项目不会被当头脑风暴删掉')
})

test('项目设置改前缀：有 issue 就不能改', () => {
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'App', key: 'APP', path: '/work/app' })
  setProjectKey(db, 'user', pid, 'APX')
  assert.equal(r.getRow(db, 'projects', pid)!.key, 'APX')
  assert.throws(() => setProjectKey(db, 'user', pid, 'apx'), /大写/)
  r.createIssue(db, 'user', pid, { title: 'x' })
  assert.throws(() => setProjectKey(db, 'user', pid, 'APY'), /已经有 issue/)
})
