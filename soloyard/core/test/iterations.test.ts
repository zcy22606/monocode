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

test('导入 product-thinking：建版本、按 plan 放功能；重新导入保留用户挪过的、跟随没挪过的', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { importProductThinking } = await import('../src/import-pt.ts')
  const dir = mkdtempSync(join(tmpdir(), 'pt-'))
  mkdirSync(join(dir, 'docs'))
  const write = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v))
  write('project.json', { name: 'app', idea: '做个 app' })
  write('docs/01-立项.json', { id: '01-立项', title: '立项卡', sections: [] })
  write('evidence.json', { items: [{ id: 'E-1', level: 'A', quote: 'x' }] })
  write('decisions.json', { decisions: [{ id: 'D-1', title: '人群', door: 'one-way', status: 'pending', user: null }] })
  const features = (plans: Record<string, string>) => ({
    iterations: [{ tag: 'v0.1', name: '骨架', goal: '跑通' }, { tag: 'v1.0', name: 'MVP' }],
    backbone: [{ id: 'BB01', name: '发现' }],
    rows: Object.entries(plans).map(([id, plan]) => ({ id, backbone: 'BB01', name: id, layer: '①竞品', plan, reason: `why ${id}` })),
  })
  write('features.json', features({ A: 'v0.1', B: 'v1.0', C: 'cut', D: 'v9.9' }))

  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/work/app')
  const res = importProductThinking(db, 'agent:t', dir, p.id)
  assert.equal(res.iterations_created, 2)
  const where = (code: string) => {
    const plan = it.iterationPlan(db, p.id)
    const f = plan.features.find((x) => x.code === code)!
    return f.iteration_id ? plan.iterations.find((i) => i.id === f.iteration_id)!.tag : f.bucket
  }
  assert.deepEqual(['A', 'B', 'C', 'D'].map(where), ['v0.1', 'v1.0', 'cut', 'pending'], '版本号对不上的放待定')
  assert.equal(it.iterationPlan(db, p.id).backbones.BB01, '发现')
  assert.equal(it.iterationPlan(db, p.id).features.find((x) => x.code === 'A')!.reason, 'why A')

  // 用户在应用里：把 A 挪到 v1.0，并决定了 D-1
  const fid = (code: string) => it.iterationPlan(db, p.id).features.find((x) => x.code === code)!.id
  it.moveFeatures(db, 'user', [fid('A')], it.iterationPlan(db, p.id).iterations[1].id)
  const d1 = db.prepare("SELECT id, data_json FROM soloyard_decisions WHERE code = 'D-1'").get() as { id: number; data_json: string }
  r.update(db, 'user', 'decisions', d1.id, { status: 'decided', data_json: JSON.stringify({ ...JSON.parse(d1.data_json), user: { option: 'A' } }) })

  // 用户在应用里删了 v0.1（功能挪去待定）：重新导入不能再建回来
  const v01 = it.iterationPlan(db, p.id).iterations.find((i) => i.tag === 'v0.1')!.id
  it.deleteIteration(db, 'user', v01, 'pending')

  // AI 重新规划：A、B 都改到 split
  write('features.json', features({ A: 'split', B: 'split', C: 'cut', D: 'v9.9' }))
  const again = importProductThinking(db, 'agent:t', dir, p.id)
  assert.equal(again.iterations_created, 0, '用户删掉的 v0.1 不重建')
  assert.deepEqual(it.iterationPlan(db, p.id).iterations.map((i) => i.tag), ['v1.0'])
  assert.equal(where('A'), 'v1.0', '用户挪过的保留')
  assert.equal(where('B'), 'split', '没挪过的跟着新安排走')
  assert.equal(it.iterationPlan(db, p.id).features.find((x) => x.code === 'A')!.ai_plan, 'split')
  const kept = db.prepare("SELECT status, data_json FROM soloyard_decisions WHERE code = 'D-1'").get() as { status: string; data_json: string }
  assert.equal(kept.status, 'decided')
  assert.deepEqual(JSON.parse(kept.data_json).user, { option: 'A' }, '用户的决定不被冲掉')
})

test('issue 移到功能表：收进待定、不进列表；功能排进迭代后回来', () => {
  const { db, p } = setup()
  const listed = (id: number) => r.listIssues(db, { projectId: p.id }).some((i) => i.id === id)
  // 没挂功能的 issue：按标题建一个待定功能挂上
  const loose = r.createIssue(db, 'user', p.id, { title: '导出 CSV', status: 'todo' })
  const fid = it.parkIssue(db, 'user', loose)
  assert.equal(where(db, p.id, fid), 'pending')
  assert.equal(plan(db, p.id).features.find((x) => x.id === fid)!.name, '导出 CSV')
  assert.equal(listed(loose), false)
  assert.equal(r.getIssue(db, loose)!.parked, 1)
  // 排回迭代：issue 回到列表，跟着迭代走
  const v1 = it.createIteration(db, 'user', p.id, { tag: 'v1.0' })
  it.moveFeatures(db, 'user', [fid], v1)
  assert.equal(listed(loose), true)
  assert.equal(r.getIssue(db, loose)!.iteration_id, v1)
  // 已挂功能的 issue：挪的是功能
  assert.equal(it.parkIssue(db, 'user', loose), fid)
  assert.equal(r.getIssue(db, loose)!.iteration_id, null)
  assert.equal(listed(loose), false)
})

test('手动建的 issue 默认排进当前迭代；没有进行中的就建「未命名迭代」；指定了就放那里；子任务不单独排', () => {
  const { db, p } = setup()
  const iterOf = (id: number) => plan(db, p.id).iterations.find((i) => i.id === r.getIssue(db, id)!.iteration_id)
  // 只有计划中的 v0.1：建一个开始了的 v0.2「未命名迭代」，排在 v0.1 前面
  it.createIteration(db, 'user', p.id, { tag: 'v0.1' })
  const first = it.createIssueInIteration(db, 'user', p.id, { title: '修崩溃' })
  assert.deepEqual([iterOf(first)!.tag, iterOf(first)!.name, iterOf(first)!.status], ['v0.2', '未命名迭代', 'active'])
  assert.deepEqual(plan(db, p.id).iterations.map((i) => i.tag), ['v0.2', 'v0.1'])
  assert.equal(plan(db, p.id).features.find((f) => f.id === r.getIssue(db, first)!.feature_id)!.name, '修崩溃')
  // 已经有进行中的：直接用它，不再建
  const second = it.createIssueInIteration(db, 'user', p.id, { title: '改文案' })
  assert.equal(iterOf(second)!.tag, 'v0.2')
  assert.equal(plan(db, p.id).iterations.length, 2)
  // 明确指定
  const v01 = plan(db, p.id).iterations.find((i) => i.tag === 'v0.1')!.id
  assert.equal(iterOf(it.createIssueInIteration(db, 'user', p.id, { title: '以后做' }, v01))!.tag, 'v0.1')
  // 子任务跟着主任务走
  const child = it.createIssueInIteration(db, 'user', p.id, { title: '子任务', parent_id: first })
  assert.equal(r.getIssue(db, child)!.feature_id, null)
})
