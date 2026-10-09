import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { issueBranch, mergeIssueBranch } from '../src/merge.ts'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim()

/** 仓库 backend（main 上有 a.txt），给 issue 开一个工作树会话，在里面提交 b.txt。 */
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-merge-')))
  const repo = join(dir, 'backend')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const wt = join(dir, 'backend-worktrees', 'ope-2')
  git(repo, 'worktree', 'add', '-q', '-b', 'mc/ope-2', wt)
  writeFileSync(join(wt, 'b.txt'), 'b\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'OPE-2 work')

  const db = openDb(':memory:')
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, worktree_cwd TEXT, updated_at INTEGER)')
  const p = r.projectForPath(db, dir)
  const issue = r.createIssue(db, 'user', p.id, { title: '决策记录', repo_path: repo })
  db.prepare('INSERT INTO sessions VALUES (?, ?, 1)').run('s1', wt)
  r.linkSession(db, 's1', 'issue', String(issue))
  return { db, repo, wt, issue }
}

test('accepting merges the issue worktree branch into the main checkout branch', () => {
  const { db, repo, wt, issue } = setup()
  assert.deepEqual(issueBranch(db, issue), { repo, worktree: wt, branch: 'mc/ope-2', target: 'main', ahead: 1, dirty: [] })
  const result = mergeIssueBranch(db, issue)
  assert.equal(result.merged, true)
  assert.ok(existsSync(join(repo, 'b.txt')), 'the change is on main now, so worktrees opened later see it')
  assert.match(git(repo, 'log', '-1', '--format=%s'), /^Merge [A-Z]+-1: 决策记录$/)
  assert.deepEqual(mergeIssueBranch(db, issue), { merged: false, reason: 'already', repo, branch: 'mc/ope-2', target: 'main' })
})

test('does not merge uncommitted work, an unclean main checkout, or conflicts (and backs a conflict out)', () => {
  const { db, repo, wt, issue } = setup()
  writeFileSync(join(wt, 'c.txt'), 'uncommitted\n')
  assert.deepEqual(mergeIssueBranch(db, issue), { merged: false, reason: 'dirty-worktree', repo, branch: 'mc/ope-2', target: 'main', files: ['?? c.txt'] })
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'c')

  writeFileSync(join(repo, 'a.txt'), 'edited on main, not committed\n')
  assert.equal((mergeIssueBranch(db, issue) as { reason: string }).reason, 'dirty-main')
  git(repo, 'checkout', '--', 'a.txt')

  writeFileSync(join(repo, 'b.txt'), 'main also wrote b\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'conflicting b on main')
  const conflict = mergeIssueBranch(db, issue) as { merged: boolean; reason: string; files: string[] }
  assert.equal(conflict.reason, 'conflict')
  assert.deepEqual(conflict.files, ['b.txt'])
  assert.equal(git(repo, 'status', '--porcelain'), '', 'the merge was aborted, main is clean')
})

test('an issue without a worktree session has nothing to merge', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/ws')
  const issue = r.createIssue(db, 'user', p.id, { title: 'x' })
  assert.deepEqual(mergeIssueBranch(db, issue), { merged: false, reason: 'nothing' })
})
