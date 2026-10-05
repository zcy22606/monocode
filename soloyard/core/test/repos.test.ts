import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import * as repos from '../src/repos.ts'

/** 假的 git 仓库：.git 目录 + HEAD。 */
function gitRepo(path: string, branch = 'main') {
  mkdirSync(join(path, '.git'), { recursive: true })
  writeFileSync(join(path, '.git/HEAD'), `ref: refs/heads/${branch}\n`)
}

/** openroboto 的样子：根目录不是仓库，rebuild/ 下有仓库，backend 有一个放在别处的工作树。 */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'soloyard-repos-'))
  const backend = join(root, 'rebuild/backend')
  gitRepo(backend)
  gitRepo(join(root, 'web'), 'dev')
  gitRepo(join(root, 'web/packages/nested')) // 仓库里面的仓库不再往下找
  gitRepo(join(root, 'node_modules/dep'))
  mkdirSync(join(root, 'docs'))
  const wt = join(root, 'rebuild/wt-rotate')
  mkdirSync(wt, { recursive: true })
  writeFileSync(join(wt, '.git'), `gitdir: ${backend}/.git/worktrees/wt-rotate\n`)
  mkdirSync(join(backend, '.git/worktrees/wt-rotate'), { recursive: true })
  writeFileSync(join(backend, '.git/worktrees/wt-rotate/gitdir'), join(wt, '.git') + '\n')
  writeFileSync(join(backend, '.git/worktrees/wt-rotate/HEAD'), 'ref: refs/heads/feat/manual-rotation\n')
  const outside = mkdtempSync(join(tmpdir(), 'soloyard-white-'))
  gitRepo(outside)
  return { root, backend, web: join(root, 'web'), wt, outside }
}

test('scan, add and describe member repos of a multi-repo project', () => {
  const w = workspace()
  const db = openDb(':memory:')
  const p = r.projectForPath(db, w.root)

  // 扫描：只找根目录下的独立仓库；工作树（.git 是文件）、仓库里的仓库、node_modules 都不算
  assert.deepEqual(repos.scanRepos(db, p.id).map((c) => [c.path, c.branch]), [[w.backend, 'main'], [w.web, 'dev']])

  const backendId = repos.addProjectRepo(db, 'user', p.id, w.backend, '后端')
  repos.addProjectRepo(db, 'user', p.id, w.web + '/')
  repos.addProjectRepo(db, 'user', p.id, w.outside, '白标站')
  assert.deepEqual(repos.scanRepos(db, p.id), [], 'members are no longer candidates')
  assert.throws(() => repos.addProjectRepo(db, 'user', p.id, w.backend), /已经是项目/)
  assert.throws(() => repos.addProjectRepo(db, 'user', p.id, join(w.root, 'nope')), /目录不存在/)

  // 成员仓库和它的子目录都归这个项目（MCP 的 get_project 也走这里）
  assert.equal(r.findProjectByPath(db, join(w.backend, 'src'))?.id, p.id)
  assert.equal(r.findProjectByPath(db, w.outside)?.id, p.id)

  const info = repos.projectRepos(db, w.outside)!
  assert.equal(info.project.root, w.root)
  assert.equal(info.project.rootIsRepo, false)
  assert.deepEqual(info.repos.map((x) => x.name), ['backend', 'web', info.repos[2].name])
  assert.deepEqual(info.repos[0].worktrees, [{ path: w.wt, name: 'wt-rotate', branch: 'feat/manual-rotation' }])
  assert.deepEqual(repos.locateWorkDir(info, w.wt)?.worktree?.name, 'wt-rotate')
  assert.equal(repos.locateWorkDir(info, join(w.web, 'src'))?.repo.name, 'web')

  repos.updateProjectRepo(db, 'user', backendId, { description: '后端 API' })
  repos.setProjectInstructions(db, 'user', p.id, '改协议先改 protocol。')
  assert.equal(repos.memberRepoPaths(db).length, 3)

  // 在根目录开的会话：成员仓库都在根目录里，只需额外开放根目录外的那个
  const atRoot = repos.projectSessionContext(db, w.root, w.root)
  assert.deepEqual(atRoot.dirs, [w.outside])
  assert.match(atRoot.map, /Project root: .*a plain folder/)
  assert.match(atRoot.map, /- backend: .* \[main\] — 后端 API/)
  assert.match(atRoot.map, /worktrees: wt-rotate \(feat\/manual-rotation\)/)
  assert.match(atRoot.map, /## Project instructions \(from the user\)\n改协议先改 protocol。/)

  // 在 backend 的工作树里：根目录（含其他仓库）和外面的仓库都开放
  const inWorktree = repos.projectSessionContext(db, w.root, w.wt)
  assert.deepEqual(inWorktree.dirs, [w.root, w.outside])
  assert.match(inWorktree.map, /This session works in backend, worktree .*wt-rotate \(branch feat\/manual-rotation\)/)

  repos.removeProjectRepo(db, 'user', backendId)
  assert.equal(repos.projectRepos(db, w.root)!.repos.length, 2)
  r.undoLast(db, 'user')
  assert.equal(repos.projectRepos(db, w.root)!.repos.length, 3, 'removal is undoable')
})

test('a plain project without repos or instructions gets no map', () => {
  const db = openDb(':memory:')
  const p = r.projectForPath(db, '/work/single')
  assert.deepEqual(repos.projectSessionContext(db, '/work/single', '/work/single'), { dirs: [], map: '' })
  repos.setProjectInstructions(db, 'user', p.id, '用 pnpm。')
  assert.match(repos.projectSessionContext(db, '/work/single').map, /用 pnpm。/)
  assert.deepEqual(repos.projectSessionContext(db, '/elsewhere'), { dirs: [], map: '' })
})

test('a lone repo next to sibling repos suggests merging into the parent; its issues move along', () => {
  const ws = mkdtempSync(join(tmpdir(), 'soloyard-hq-'))
  const api = join(ws, 'hackquest-api-v2')
  for (const name of ['hackquest-api-v2', 'hackquest-admin', 'hackquest-app']) gitRepo(join(ws, name))
  mkdirSync(join(ws, 'due-diligence'))
  const db = openDb(':memory:')
  const own = r.projectForPath(db, api)
  r.createIssue(db, 'user', own.id, { title: '论坛管理员角色' })

  const suggestion = repos.parentSuggestion(db, api)!
  assert.equal(suggestion.parent, ws)
  assert.deepEqual(suggestion.repos.map((x) => x.name), ['hackquest-admin', 'hackquest-api-v2', 'hackquest-app'])
  assert.equal(repos.parentSuggestion(db, join(ws, 'due-diligence')), null, 'not a repo')

  const id = repos.mergeIntoParent(db, 'user', api, ws, [join(ws, 'hackquest-admin'), join(ws, 'hackquest-app')])
  assert.equal(id, own.id, 'the existing project moves up and keeps its issues')
  const info = repos.projectRepos(db, ws)!
  assert.equal(info.project.name, basename(ws))
  assert.equal(info.project.root, ws)
  assert.deepEqual(info.repos.map((x) => x.name), ['hackquest-api-v2', 'hackquest-admin', 'hackquest-app'])
  assert.equal(r.findProjectByPath(db, join(ws, 'hackquest-app/src'))?.id, own.id)
  assert.equal(r.listIssues(db, { projectId: own.id }).length, 1)
  assert.equal(repos.parentSuggestion(db, api), null, 'already merged')
})

test('opening a plain folder full of repos suggests making it a multi-repo project', () => {
  const w = workspace()
  const db = openDb(':memory:')
  const s = repos.setupSuggestion(db, w.root)!
  assert.equal(s.kind, 'root')
  assert.deepEqual(s.repos.map((c) => c.path), [w.backend, w.web])
  assert.equal(repos.setupSuggestion(db, w.backend), null, 'a repo without sibling repos at its level')

  const id = repos.mergeIntoParent(db, 'user', w.root, w.root, [w.backend])
  assert.deepEqual(repos.projectRepos(db, w.root)!.repos.map((r) => r.path), [w.backend], 'the root itself is not a member')
  assert.equal(r.findProjectByPath(db, w.root)?.id, id)
  assert.equal(repos.setupSuggestion(db, w.root), null, 'already has members')
})
