import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { addEvidence, adoptTwoWay, decide, getDecision, listDecisions, listEvidence, upsertDecisions } from '../src/decisions.ts'
import { revertBatch } from '../src/iterations.ts'

const opts = [{ key: 'A', label: '副业新手' }, { key: 'B', label: '腰部博主' }]

test('决策：agent 写选项不拍板；用户拍板 / 代记要原话；改主意留痕；agent 再补充不冲掉决定', () => {
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'App', path: '/work/app', stage: 'initiating' })
  upsertDecisions(db, 'agent:x', pid, [
    { code: 'D-2', title: '首要人群', door: 'one-way', options: opts, ai: { option: 'A', reason: '渠道' }, counter: '留存差' },
    { code: 'D-3', title: '形态', door: 'two-way', options: [{ key: 'A', label: '网页' }, { key: 'B', label: '小程序' }], ai: { option: 'B' } },
    { code: 'D-4', title: '语言', door: 'two-way', options: [{ key: 'A', label: '中文' }] },
  ])
  assert.deepEqual(listDecisions(db, pid).map((d) => [d.code, d.status]), [['D-2', 'pending'], ['D-3', 'pending'], ['D-4', 'pending']])
  assert.throws(() => upsertDecisions(db, 'agent:x', pid, [{ code: 'D-9' }]), /标题/)

  assert.throws(() => decide(db, 'agent:x', pid, 'D-2', { option: 'A', via: '对话' }), /原话/)
  assert.throws(() => decide(db, 'user', pid, 'D-2', { option: 'C', via: '应用' }), /没有选项 C/)
  decide(db, 'agent:x', pid, 'D-2', { option: 'B', via: '对话', quote: '先做腰部博主吧' })
  decide(db, 'user', pid, 'D-2', { option: 'A', via: '应用', note: '想了想还是新手' })
  const d2 = getDecision(db, pid, 'D-2')!
  assert.deepEqual([d2.status, d2.user?.option, d2.user?.via, d2.user?.by], ['decided', 'A', '应用', 'user'])
  const history = db.prepare("SELECT COUNT(*) AS n FROM soloyard_changes WHERE entity = 'decisions' AND entity_id = ? AND op = 'update'").get(d2.id) as { n: number }
  assert.equal(history.n, 2, '两次拍板都在变更历史里')

  upsertDecisions(db, 'agent:x', pid, [{ code: 'D-2', counter: '新的反方', aliases: ['DF-08'] }])
  const again = getDecision(db, pid, 'DF-08')!
  assert.deepEqual([again.code, again.status, again.user?.option, again.counter, again.title], ['D-2', 'decided', 'A', '新的反方', '首要人群'])

  const { batch, adopted } = adoptTwoWay(db, 'user', pid)
  assert.deepEqual(adopted, ['D-3'], '只采纳有 AI 推荐的双向门')
  assert.equal(getDecision(db, pid, 'D-3')!.user?.option, 'B')
  revertBatch(db, 'user', batch)
  assert.equal(getDecision(db, pid, 'D-3')!.status, 'pending', '整批撤销')
})

test('证据：自动编号、按编号 / 关键词查、同编号覆盖', () => {
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'App', path: '/work/app' })
  assert.deepEqual(addEvidence(db, 'agent:x', pid, [{ claim: '新手不懂数据', quote: '看不懂', level: 'B' }, { claim: '千瓜太贵', level: 'A' }]), ['E-1', 'E-2'])
  assert.deepEqual(addEvidence(db, 'agent:x', pid, [{ code: 'E-1', claim: '新手看不懂数据', level: 'B+' }, { claim: '第三条' }]), ['E-1', 'E-3'])
  assert.deepEqual(listEvidence(db, pid).map((e) => [e.code, e.level]), [['E-1', 'B+'], ['E-2', 'A'], ['E-3', null]])
  assert.deepEqual(listEvidence(db, pid, { q: '千瓜' }).map((e) => e.code), ['E-2'])
  assert.deepEqual(listEvidence(db, pid, { codes: ['E-3'] }).map((e) => e.verified), ['未回查'])
})
