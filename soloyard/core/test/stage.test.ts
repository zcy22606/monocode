import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import * as it from '../src/iterations.ts'
import { projectStage, setProjectStage } from '../src/stage.ts'

test('立项期小步按数据推：待立项 → 待拍板 → 待排版本 → 待减法 → 开始迭代即建造', () => {
  const db = openDb(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'soloyard-stage-'))
  const pid = r.createProject(db, 'user', { name: 'App', path: root, stage: 'initiating' })
  const step = () => projectStage(db, pid)
  assert.deepEqual([step().stage, step().step, step().next?.prompt], ['initiating', 'charter', true])

  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', '01-立项.json'), '{}')
  r.insert(db, 'agent:x', 'decisions', { project_id: pid, code: 'D-2', title: '首要人群', door: 'one-way', status: 'pending' })
  r.insert(db, 'agent:x', 'decisions', { project_id: pid, code: 'D-3', title: '形态', door: 'two-way', status: 'pending' })
  assert.deepEqual([step().step, step().next?.view], ['decide', 'decisions'], '只有单向门卡住')

  db.prepare("UPDATE soloyard_decisions SET status = 'decided' WHERE code = 'D-2'").run()
  assert.equal(step().step, 'versions', '双向门没定不卡')

  const v1 = it.createIteration(db, 'user', pid, { tag: 'v0.1' })
  assert.deepEqual([step().step, step().next?.view], ['cut', 'cycles'])

  it.startIteration(db, 'user', v1, [])
  assert.deepEqual([step().stage, step().step], ['building', undefined])
})

test('添加文件夹建的项目直接是建造期；迁移把旧的 scribble 当建造', () => {
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'Old', path: '/work/old' })
  assert.equal(projectStage(db, pid).stage, 'building')
  db.prepare("UPDATE soloyard_projects SET stage = 'scribble' WHERE id = ?").run(pid)
  assert.equal(projectStage(db, pid).stage, 'building')
})

test('手动改阶段：搁置 / 恢复回原来的期；放弃要原因；上线只能从建造', () => {
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'App', path: '/work/app', stage: 'initiating' })
  assert.throws(() => setProjectStage(db, 'user', pid, 'launched'), /建造期/)
  assert.throws(() => setProjectStage(db, 'user', pid, 'killed'), /原因/)
  assert.throws(() => setProjectStage(db, 'user', pid, 'resume'), /恢复/)

  setProjectStage(db, 'user', pid, 'parked', '先做别的')
  const parked = projectStage(db, pid)
  assert.deepEqual([parked.stage, parked.note?.from, parked.note?.reason, parked.next], ['parked', 'initiating', '先做别的', undefined])
  assert.throws(() => setProjectStage(db, 'user', pid, 'killed', 'x'), /先恢复/)

  setProjectStage(db, 'user', pid, 'resume')
  assert.deepEqual([projectStage(db, pid).stage, projectStage(db, pid).note], ['initiating', undefined])

  const b = r.createProject(db, 'user', { name: 'B', path: '/work/b' })
  setProjectStage(db, 'user', b, 'launched')
  assert.equal(projectStage(db, b).stage, 'launched')
})
