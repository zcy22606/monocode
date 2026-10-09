/**
 * Soloyard：验收通过 = 代码进主干。issue 的会话在某个仓库的工作树里干活（并行开工、带仓库的 Start work 都是），
 * 验收时把那个工作树的分支合进仓库主检出当前所在的分支——依赖它的子任务之后新开的工作树才看得到这些改动。
 * 工作树里还有没提交的改动、主检出不干净、合并冲突时都不合（冲突会撤回），由界面告诉用户、不改状态。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import type { Row } from './repo.ts'

export type IssueBranch = {
  /** 主检出（仓库本身）。 */
  repo: string
  worktree: string
  branch: string
  /** 合到哪：主检出当前所在的分支；分离头指针时为空。 */
  target: string
  /** 分支上还没合进 target 的提交数。 */
  ahead: number
  /** 工作树里没提交的改动（git status --porcelain 的行）。 */
  dirty: string[]
}

export type MergeResult =
  | { merged: true; repo: string; branch: string; target: string; commit: string }
  | { merged: false; reason: 'nothing' | 'already'; repo?: string; branch?: string; target?: string }
  | { merged: false; reason: 'dirty-worktree' | 'dirty-main' | 'conflict' | 'no-target' | 'failed'; repo: string; branch: string; target: string; files: string[]; message?: string }

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const lines = (text: string) => text.split('\n').map((l) => l.trimEnd()).filter(Boolean)

/** 工作树的主仓库：工作树里的 .git 是文件，gitdir 指回 <主仓库>/.git/worktrees/<名字>。不是工作树返回 null。 */
function mainRepoOf(worktree: string): string | null {
  try {
    const file = join(worktree, '.git')
    if (!statSync(file).isFile()) return null
    const gitdir = /gitdir:\s*(.+)/.exec(readFileSync(file, 'utf8'))?.[1].trim() ?? ''
    const at = gitdir.indexOf('/.git/worktrees/')
    return at > 0 ? gitdir.slice(0, at) : null
  } catch {
    return null
  }
}

/** issue 最近一个在工作树里干活的会话 → 它的分支、要合到哪。没有（直接在仓库里干的、会话没发出去）返回 null。 */
export function issueBranch(db: DB, issueId: number): IssueBranch | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()) return null
  const rows = db.prepare(`SELECT s.worktree_cwd FROM soloyard_session_links l JOIN sessions s ON s.id = l.session_id
    WHERE l.kind = 'issue' AND l.target = ? AND COALESCE(s.worktree_cwd, '') <> '' ORDER BY s.updated_at DESC`).all(String(issueId)) as Row[]
  for (const { worktree_cwd: worktree } of rows) {
    const repo = existsSync(worktree) ? mainRepoOf(worktree) : null
    if (!repo) continue
    try {
      const branch = git(worktree, ['branch', '--show-current'])
      if (!branch) continue
      const target = git(repo, ['branch', '--show-current'])
      const ahead = target ? Number(git(repo, ['rev-list', '--count', `${target}..${branch}`])) : 0
      return { repo, worktree, branch, target, ahead, dirty: lines(git(worktree, ['status', '--porcelain'])) }
    } catch {
      continue
    }
  }
  return null
}

/** 把 issue 工作树的分支合进仓库主检出当前的分支（--no-ff，提交信息带 issue 编号）。只合并，不改 issue 状态。 */
export function mergeIssueBranch(db: DB, issueId: number): MergeResult {
  const b = issueBranch(db, issueId)
  if (!b) return { merged: false, reason: 'nothing' }
  const where = { repo: b.repo, branch: b.branch, target: b.target }
  if (b.dirty.length) return { merged: false, reason: 'dirty-worktree', ...where, files: b.dirty }
  if (!b.target) return { merged: false, reason: 'no-target', ...where, files: [] }
  if (!b.ahead) return { merged: false, reason: 'already', ...where }
  const mainDirty = lines(git(b.repo, ['status', '--porcelain', '--untracked-files=no']))
  if (mainDirty.length) return { merged: false, reason: 'dirty-main', ...where, files: mainDirty }
  const issue = db.prepare("SELECT p.key || '-' || i.number AS ident, i.title FROM soloyard_issues i JOIN soloyard_projects p ON p.id = i.project_id WHERE i.id = ?").get(issueId) as Row | undefined
  const message = issue ? `Merge ${issue.ident}: ${issue.title}` : `Merge ${b.branch}`
  try {
    git(b.repo, ['merge', '--no-ff', '--no-edit', '-m', message, b.branch])
  } catch (e) {
    const files = (() => {
      try {
        return lines(git(b.repo, ['diff', '--name-only', '--diff-filter=U']))
      } catch {
        return []
      }
    })()
    try {
      git(b.repo, ['merge', '--abort'])
    } catch {
      // 没开始合并（比如未跟踪文件会被覆盖）就没有可撤回的
    }
    const stderr = (e as { stderr?: string }).stderr?.trim() ?? String(e)
    return { merged: false, reason: files.length ? 'conflict' : 'failed', ...where, files, message: stderr }
  }
  return { merged: true, ...where, commit: git(b.repo, ['rev-parse', '--short', 'HEAD']) }
}
