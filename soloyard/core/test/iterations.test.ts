import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import * as it from '../src/iterations.ts'

function setup() {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/work/app')
  const feature = (code: string, tier: string, level: string | null = null) =>
    r.insert(db, 'user', 'features', { project_id: p.id, code, name: code, tier, level, data_json: JSON.stringify({ reason: `why ${code}` }) })
  const f = { a: feature('A', '骨架'), b: feature('B', 'v1'), c: feature('C', '后续', '常见'), d: feature('D', '后续', '相邻独有'), e: feature('E', '不建议'), x: feature('X', '') }
  return { db, p, f }
}
const plan = (db: ReturnType<typeof openDb>, pid: number) => it.iterationPlan(db, pid)
const where = (db: ReturnType<typeof openDb>, pid: number, fid: number) => {
  const f = plan(db, pid).features.find((x) => x.id === fid)!
  return f.iteration_id ? plan(db, pid).iterations.find((i) => i.id === f.iteration_id)!.tag : f.bucket
}

test('按 AI 分层生成迭代表；版本号查重；插入位置', () => {
  const { db, p, f } = setup()
  it.generateIterations(db, 'user', p.id)
  assert.deepEqual(plan(db, p.id).iterations.map((i) => i.tag), ['v0.1', 'v1.0', 'v1.1', 'v2.0'])
  assert.deepEqual([f.a, f.b, f.c, f.d, f.e, f.x].map((id) => where(db, p.id, id)), ['v0.1', 'v1.0', 'v1.1', 'v2.0', 'cut', 'pending'])
  assert.equal(plan(db, p.id).features.find((x) => x.id === f.c)!.ai_plan, 'v1.1')
  assert.throws(() => it.generateIterations(db, 'user', p.id), /已经有迭代/)

  assert.throws(() => it.createIteration(db, 'user', p.id, { tag: '1.0' }), /已经有了/)
  const v10 = plan(db, p.id).iterations[1].id
  it.createIteration(db, 'user', p.id, { tag: 'v0.5', name: '中间' }, v10)
  assert.deepEqual(plan(db, p.id).iterations.map((i) => i.tag), ['v0.1', 'v0.5', 'v1.0', 'v1.1', 'v2.0'])
  it.moveIteration(db, 'user', plan(db, p.id).iterations[0].id, null)
  assert.equal(plan(db, p.id).iterations.at(-1)!.tag, 'v0.1')
})

test('删除迭代：功能和 issue 一起挪走；整批撤销；之后有修改就不能撤销', () => {
  const { db, p, f } = setup()
  it.generateIterations(db, 'user', p.id)
  const [v01, v10] = plan(db, p.id).iterations.map((i) => i.id)
  const issue = it.createFeatureIssue(db, 'user', f.a)
  assert.equal(r.getIssue(db, issue)!.iteration_id, v01)

  const batch = it.deleteIteration(db, 'user', v01, v10)
  assert.equal(where(db, p.id, f.a), 'v1.0')
  assert.equal(r.getIssue(db, issue)!.iteration_id, v10, 'issue 跟着功能走')
  it.revertBatch(db, 'user', batch)
  assert.equal(where(db, p.id, f.a), 'v0.1')
  assert.equal(r.getIssue(db, issue)!.iteration_id, v01)

  const again = it.deleteIteration(db, 'user', v01, 'pending')
  it.moveFeatures(db, 'user', [f.a], 'split')
  assert.throws(() => it.revertBatch(db, 'user', again), /不能再撤销/)
})

test('开始：只给勾选的建 issue；完成：挪走没做完的、冻结统计、锁定；重新打开解锁', () => {
  const { db, p, f } = setup()
  const v1 = it.createIteration(db, 'user', p.id, { tag: 'v1' })
  const v2 = it.createIteration(db, 'user', p.id, { tag: 'v2' })
  it.moveFeatures(db, 'user', [f.a, f.b, f.c], v1)
  it.startIteration(db, 'user', v1, [f.a, f.b])
  const fs = () => plan(db, p.id).features
  assert.equal(fs().filter((x) => x.issue_id).length, 2)
  assert.match(r.getIssue(db, fs().find((x) => x.id === f.a)!.issue_id)!.body_md, /why A/)

  r.updateIssue(db, 'user', fs().find((x) => x.id === f.a)!.issue_id, { status: 'done' })
  it.finishIteration(db, 'user', v1, { [f.a]: v2, [f.b]: v2, [f.c]: 'pending' })
  assert.deepEqual([f.a, f.b, f.c].map((id) => where(db, p.id, id)), ['v1', 'v2', 'pending'], '做完的不挪')
  assert.deepEqual(plan(db, p.id).iterations[0].summary, { done: 1, moved: 2 })
  assert.throws(() => it.moveFeatures(db, 'user', [f.a], v2), /锁定/)
  assert.throws(() => it.moveFeatures(db, 'user', [f.d], v1), /锁定/)

  it.reopenIteration(db, 'user', v1)
  it.moveFeatures(db, 'user', [f.d], v1)
  assert.equal(where(db, p.id, f.d), 'v1')
})

test('手动新建 / 改名 / 删除功能；删除后 issue 保留并可撤销', () => {
  const { db, p } = setup()
  const id = it.createFeature(db, 'user', p.id, { name: '导出 ROADMAP' })
  assert.equal(plan(db, p.id).features.find((x) => x.id === id)!.code, 'F-001')
  const second = it.createFeature(db, 'user', p.id, { name: '二' })
  assert.equal(plan(db, p.id).features.find((x) => x.id === second)!.code, 'F-002')
  it.renameFeature(db, 'user', id, '导出 ROADMAP.md')
  const issue = it.createFeatureIssue(db, 'user', id)
  const batch = it.deleteFeature(db, 'user', id)
  assert.equal(r.getIssue(db, issue)!.feature_id, null)
  it.revertBatch(db, 'user', batch)
  assert.equal(r.getIssue(db, issue)!.feature_id, id)
  assert.equal(plan(db, p.id).features.find((x) => x.id === id)!.name, '导出 ROADMAP.md')
})
