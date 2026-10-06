/**
 * Soloyard：多仓库项目。项目有一个根目录（soloyard_project_paths，可以不是 git 仓库），
 * 下面或别处挂若干成员仓库（soloyard_project_repos，各一句说明），再加一段项目说明（projects.instructions）。
 * 每个会话启动时把这些拼成「项目地图」交给 agent，并给它开放所有成员仓库的读写。
 * 分支、工作树都直接读 .git 里的文件，不起 git 进程。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { tx } from './db.ts'
import type { DB } from './db.ts'
import { type Actor, type Row, findProjectByPath, getRow, insert, projectForPath, remove, update } from './repo.ts'

export type Worktree = { path: string; name: string; branch: string | null }
export type RepoInfo = { id: number; path: string; name: string; description: string; branch: string | null; worktrees: Worktree[]; missing: boolean }
export type ProjectRepos = {
  project: { id: number; key: string; name: string; instructions: string; root: string | null; rootIsRepo: boolean }
  repos: RepoInfo[]
}
export type RepoCandidate = { path: string; name: string; branch: string | null }

const clean = (path: string) => path.replace(/\/+$/, '')
const inside = (path: string, root: string) => path === root || path.startsWith(root + '/')

/** 仓库自己的 .git 目录；工作树 / 子模块的 .git 是文件，不算独立仓库。 */
function ownGitDir(path: string): string | null {
  try {
    return statSync(join(path, '.git')).isDirectory() ? join(path, '.git') : null
  } catch {
    return null
  }
}

/** HEAD 指向的分支；分离头指针或读不到时为 null。 */
function headBranch(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null
  } catch {
    return null
  }
}

/** 仓库的工作树：.git/worktrees/<名字>/gitdir 指向工作树里的 .git 文件；目录已删的跳过。 */
function worktreesOf(gitDir: string): Worktree[] {
  const dir = join(gitDir, 'worktrees')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    try {
      const path = dirname(readFileSync(join(dir, name, 'gitdir'), 'utf8').trim())
      return existsSync(path) ? [{ path, name: basename(path), branch: headBranch(join(dir, name)) }] : []
    } catch {
      return []
    }
  })
}

function repoInfo(row: Row): RepoInfo {
  const git = ownGitDir(row.path)
  return {
    id: row.id, path: row.path, name: basename(row.path), description: row.description,
    branch: git && headBranch(git), worktrees: git ? worktreesOf(git) : [], missing: !existsSync(row.path),
  }
}

/** 项目的根目录：关联目录里最短的那个（通常只有一个）。 */
function projectRoot(db: DB, projectId: number): string | null {
  const row = db.prepare('SELECT path FROM soloyard_project_paths WHERE project_id = ? ORDER BY length(path) LIMIT 1').get(projectId) as Row | undefined
  return row ? clean(row.path) : null
}

/** 路径（根目录、成员仓库或它们的子目录）所在项目的仓库全貌；不在任何项目里返回 null。 */
export function projectRepos(db: DB, path: string): ProjectRepos | null {
  const p = findProjectByPath(db, path)
  if (!p) return null
  const root = projectRoot(db, p.id)
  const rows = db.prepare('SELECT * FROM soloyard_project_repos WHERE project_id = ? ORDER BY sort, id').all(p.id) as Row[]
  return {
    project: { id: p.id, key: p.key, name: p.name, instructions: p.instructions ?? '', root, rootIsRepo: !!root && !!ownGitDir(root) },
    repos: rows.map(repoInfo),
  }
}

/** 所有项目的成员仓库路径：侧栏项目列表据此藏掉成员仓库（它们从父项目进）。 */
export function memberRepoPaths(db: DB): string[] {
  return (db.prepare('SELECT path FROM soloyard_project_repos').all() as Row[]).map((r) => r.path)
}

/** 根目录下（最多三层）还没加入任何项目的 git 仓库。不进 node_modules、隐藏目录，也不进仓库内部。 */
export function scanRepos(db: DB, projectId: number): RepoCandidate[] {
  const root = projectRoot(db, projectId)
  return root ? scanUnder(db, root) : []
}

function scanUnder(db: DB, root: string): RepoCandidate[] {
  const taken = new Set(memberRepoPaths(db))
  const found: RepoCandidate[] = []
  const walk = (dir: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      const path = join(dir, e.name)
      const git = ownGitDir(path)
      if (git) {
        if (!taken.has(path)) found.push({ path, name: e.name, branch: headBranch(git) })
      } else if (depth > 1) walk(path, depth - 1)
    }
  }
  if (!ownGitDir(root)) walk(root, 3)
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

export function addProjectRepo(db: DB, actor: Actor, projectId: number, path: string, description = ''): number {
  const p = clean(path)
  if (!p.startsWith('/')) throw new Error(`要用绝对路径：${path}`)
  if (!existsSync(p)) throw new Error(`目录不存在：${p}`)
  const owner = db.prepare('SELECT p.name FROM soloyard_project_repos r JOIN soloyard_projects p ON p.id = r.project_id WHERE r.path = ?').get(p) as Row | undefined
  if (owner) throw new Error(`${basename(p)} 已经是项目「${owner.name}」的仓库`)
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM soloyard_project_repos WHERE project_id = ?').get(projectId) as Row).n
  return insert(db, actor, 'project_repos', { project_id: projectId, path: p, description, sort })
}

export function updateProjectRepo(db: DB, actor: Actor, id: number, patch: { description?: string; sort?: number }) {
  return update(db, actor, 'project_repos', id, patch)
}

export function removeProjectRepo(db: DB, actor: Actor, id: number) {
  remove(db, actor, 'project_repos', id)
}

export function setProjectInstructions(db: DB, actor: Actor, projectId: number, instructions: string) {
  if (!getRow(db, 'projects', projectId)) throw new Error(`project ${projectId} not found`)
  return update(db, actor, 'projects', projectId, { instructions })
}

/** 工作目录落在哪个成员仓库（仓库本身、子目录或它的工作树）。 */
export function locateWorkDir(info: ProjectRepos, workCwd: string): { repo: RepoInfo; worktree?: Worktree } | null {
  const cwd = clean(workCwd)
  for (const repo of info.repos) {
    if (inside(cwd, repo.path)) return { repo }
    const worktree = repo.worktrees.find((w) => inside(cwd, w.path))
    if (worktree) return { repo, worktree }
  }
  return null
}

/**
 * 交给 agent 的项目地图（放在系统提示里，不进对话记录）。没有成员仓库也没有项目说明时为空串。
 * 写成英文：和 agent 自己的系统提示一致；用户写的说明原样放进去。
 */
export function projectMap(info: ProjectRepos, workCwd?: string): string {
  const { project, repos } = info
  const instructions = project.instructions.trim()
  if (!repos.length && !instructions) return ''
  const lines = [`# Soloyard project: ${project.name} (issue key ${project.key})`]
  if (project.root) lines.push(`Project root: ${project.root}${project.rootIsRepo ? '' : ' (a plain folder, not a git repository; the repositories are listed below)'}`)
  if (workCwd) {
    const at = locateWorkDir(info, workCwd)
    lines.push(at
      ? `This session works in ${at.repo.name}${at.worktree ? `, worktree ${at.worktree.path}${at.worktree.branch ? ` (branch ${at.worktree.branch})` : ''}` : at.repo.branch ? ` (branch ${at.repo.branch})` : ''}. The other repositories are also accessible.`
      : `This session works in ${clean(workCwd)}${project.root && clean(workCwd) === project.root ? ', the project root, across repositories' : ''}.`)
  }
  if (repos.length) {
    lines.push('', '## Repositories')
    for (const r of repos) {
      if (r.missing) continue
      lines.push(`- ${r.name}: ${r.path}${r.branch ? ` [${r.branch}]` : ''}${r.description ? ` — ${r.description}` : ''}`)
      if (r.worktrees.length) {
        const shown = r.worktrees.slice(0, 8).map((w) => `${w.name}${w.branch ? ` (${w.branch})` : ''}`)
        lines.push(`  worktrees: ${shown.join(', ')}${r.worktrees.length > 8 ? `, … ${r.worktrees.length - 8} more` : ''}`)
      }
    }
  }
  if (instructions) lines.push('', '## Project instructions (from the user)', instructions)
  return lines.join('\n')
}

/**
 * 发送前：要开放给 agent 的目录（根目录 + 成员仓库，已经在工作目录里的不重复给）和项目地图。
 * 交给 Claude 的 --add-dir / Codex 的可写目录，和会话关联的文件夹合在一起。
 */
export function projectSessionContext(db: DB, cwd?: string, workCwd?: string): { dirs: string[]; map: string } {
  const info = cwd ? projectRepos(db, cwd) : null
  if (!info) return { dirs: [], map: '' }
  const work = clean(workCwd || cwd!)
  const dirs = info.repos.length
    ? [info.project.root, ...info.repos.filter((r) => !r.missing).map((r) => r.path)]
        .filter((d): d is string => !!d && existsSync(d) && !inside(d, work))
    : []
  return { dirs: dirs.filter((d) => !dirs.some((o) => o !== d && inside(d, o))), map: projectMap(info, work) }
}

/**
 * 单仓库项目的上级目录里还有别的仓库（hackquest-api-v2 旁边的 admin、app）：提示合成一个多仓库项目。
 * 当前目录得是独立仓库、还不是谁的成员；上级目录不是家目录、不是仓库，里面至少还有一个仓库。
 */
export function parentSuggestion(db: DB, cwd: string): { parent: string; repos: RepoCandidate[] } | null {
  const path = clean(cwd)
  const parent = dirname(path)
  if (!ownGitDir(path) || parent === path || parent === '/' || parent === homedir() || ownGitDir(parent)) return null
  const taken = new Set(memberRepoPaths(db))
  if (taken.has(path)) return null
  let entries
  try {
    entries = readdirSync(parent, { withFileTypes: true })
  } catch {
    return null
  }
  const repos = entries.flatMap((e) => {
    const p = join(parent, e.name)
    const git = e.isDirectory() && !e.name.startsWith('.') ? ownGitDir(p) : null
    return git && !taken.has(p) ? [{ path: p, name: e.name, branch: headBranch(git) }] : []
  })
  return repos.length > 1 ? { parent, repos: repos.sort((a, b) => a.name.localeCompare(b.name)) } : null
}

/**
 * 合成多仓库项目：根目录是 parent，勾选的仓库成为成员。当前目录原来有自己的项目（可能已经有 issue）时，
 * 直接把那个项目挪到上级目录、改名，issue 和编号都留着；否则在上级目录建（或用已有的）项目。
 */
export function mergeIntoParent(db: DB, actor: Actor, cwd: string, parent: string, paths: string[]): number {
  return tx(db, () => {
    const from = clean(cwd)
    const root = clean(parent)
    const own = db.prepare('SELECT project_id FROM soloyard_project_paths WHERE path = ?').get(from) as Row | undefined
    const atRoot = db.prepare('SELECT project_id FROM soloyard_project_paths WHERE path = ?').get(root) as Row | undefined
    let projectId: number
    if (own && !atRoot) {
      db.prepare('UPDATE soloyard_project_paths SET path = ? WHERE project_id = ? AND path = ?').run(root, own.project_id, from)
      update(db, actor, 'projects', own.project_id, { name: basename(root) })
      projectId = own.project_id
    } else projectId = projectForPath(db, root).id
    const members = new Set(memberRepoPaths(db))
    const picked = from === root ? paths.map(clean) : [from, ...paths.map(clean)] // 根目录自己不算成员
    for (const path of new Set(picked)) if (path !== root && !members.has(path)) addProjectRepo(db, actor, projectId, path)
    return projectId
  })
}

export type SetupSuggestion = { kind: 'root' | 'parent'; root: string; current?: string; repos: RepoCandidate[] }

/**
 * 打开一个项目时要不要提示设成多仓库项目：
 * - parent：它是独立仓库，上级目录里还有别的仓库（hackquest-api-v2）——合成到上级目录；
 * - root：它是普通文件夹，下面有 git 仓库，而且还没有成员仓库（openroboto）——把这些仓库加进来。
 */
export function setupSuggestion(db: DB, cwd: string): SetupSuggestion | null {
  const path = clean(cwd)
  const parent = parentSuggestion(db, path)
  if (parent) return { kind: 'parent', root: parent.parent, current: path, repos: parent.repos }
  if (ownGitDir(path) || path === '/' || path === homedir() || memberRepoPaths(db).includes(path)) return null
  const own = db.prepare('SELECT project_id FROM soloyard_project_paths WHERE path = ?').get(path) as Row | undefined
  if (own && db.prepare('SELECT 1 FROM soloyard_project_repos WHERE project_id = ?').get(own.project_id)) return null
  const repos = scanUnder(db, path)
  return repos.length ? { kind: 'root', root: path, repos } : null
}

/**
 * issue 的仓库：agent 传仓库名（openroboto-backend）或路径都行，统一成项目里那个成员仓库的路径。
 * 空 / null = 在项目根目录做；项目里没有这个仓库就报错，提示用 get_project 看仓库列表。
 */
export function resolveRepo(db: DB, projectId: number, ref: string | null | undefined): string | null {
  const wanted = ref?.trim()
  if (!wanted) return null
  const rows = db.prepare('SELECT path FROM soloyard_project_repos WHERE project_id = ?').all(projectId) as Row[]
  const hit = rows.find((r) => r.path === clean(wanted)) ?? rows.find((r) => basename(r.path) === wanted)
  if (!hit) {
    const names = rows.map((r) => basename(r.path)).join(', ')
    throw new Error(`项目里没有仓库「${wanted}」${names ? `（有：${names}）` : '（这个项目还没有成员仓库）'}`)
  }
  return hit.path
}
