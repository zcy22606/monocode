import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as it from '../src/iterations.ts'
import { PHONE_METHODS, projectIssues } from '../src/phone.ts'
import * as r from '../src/repo.ts'

test('手机 Issues 栏：当前迭代和进度、issue 带挂着的会话、每个会话挂的 issue', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/work/app')
  const a = it.createIssueInIteration(db, 'user', p.id, { title: '退款回调加锁', priority: 2 })
  const b = it.createIssueInIteration(db, 'user', p.id, { title: '导出慢' })
  r.updateIssue(db, 'user', b, { status: 'done' })
  r.linkSession(db, 'sess-1', 'issue', String(a))
  r.linkSession(db, 'sess-2', 'file', '/work/app/a.ts')

  const view = projectIssues(db, '/work/app')!
  assert.equal(view.project.id, p.id)
  assert.deepEqual({ done: view.iteration?.done, total: view.iteration?.total }, { done: 1, total: 2 })
  const first = view.issues.find((i) => i.id === a)!
  assert.equal(first.title, '退款回调加锁')
  assert.equal(first.current, true)
  assert.deepEqual(first.sessions, ['sess-1'])
  assert.equal(view.sessionIssues['sess-1'].ident, first.ident)
  assert.equal(view.sessionIssues['sess-2'], undefined, '挂的不是 issue 不算')
  assert.equal(projectIssues(db, '/elsewhere'), null)
})

test('手机能调的只有白名单里的，改 issue 只认状态和优先级', () => {
  assert.equal(PHONE_METHODS.deleteIteration, undefined)
  assert.equal(PHONE_METHODS.updateProject, undefined)
  assert.deepEqual(PHONE_METHODS.updateIssue([7, { status: 'in_review', title: '改标题', project_id: 9 }]), ['updateIssue', [7, { status: 'in_review' }]])
  assert.throws(() => PHONE_METHODS.updateIssue([7, { title: 'x' }]), /Nothing to change/)
  assert.deepEqual(PHONE_METHODS.createIssue([3, { title: '  新的  ', priority: 1, status: 'done' }]), ['createIssue', [3, { title: '新的', priority: 1 }]])
  assert.throws(() => PHONE_METHODS.createIssue([3, { title: ' ' }]), /title/)
  assert.deepEqual(PHONE_METHODS.linkIssue(['sess-1', '12']), ['linkSession', ['sess-1', 'issue', '12']])
})
