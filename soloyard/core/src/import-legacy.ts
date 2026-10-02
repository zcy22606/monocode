/**
 * 一次性把 Electron 原型的库（indie-desk.db）导进 Soloyard 的表。
 * 按项目整体搬：项目、关联目录、想法、文档、决策、证据、功能全景、里程碑、迭代（→ cycles）、issue、依赖、验收项、评论。
 * 所有 id 重新编号；导过的项目在 meta_json.legacy 里记来源，重复执行会跳过。变更历史和原型的会话收编不导。
 */
import { DatabaseSync } from 'node:sqlite'
import type { DB } from './db.ts'
import { tx } from './db.ts'

type Row = Record<string, any>

export function importLegacy(db: DB, legacyPath: string) {
  const old = new DatabaseSync(legacyPath, { readOnly: true })
  const all = (sql: string, ...args: any[]) => old.prepare(sql).all(...args) as Row[]
  const has = (table: string) => !!old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  const counts: Record<string, number> = {}
  const add = (table: string, row: Row) => {
    const cols = Object.keys(row)
    const r = db.prepare(`INSERT INTO soloyard_${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]))
    counts[table] = (counts[table] ?? 0) + 1
    return Number(r.lastInsertRowid)
  }
  const pick = (row: Row, cols: string[]) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]))
  const imported = new Set((db.prepare("SELECT json_extract(meta_json, '$.legacy.id') AS id FROM soloyard_projects WHERE json_extract(meta_json, '$.legacy.db') = ?").all(legacyPath) as Row[]).map((r) => r.id))
  const skipped: string[] = []

  tx(db, () => {
    for (const p of all('SELECT * FROM projects')) {
      if (imported.has(p.id)) { skipped.push(p.key); continue }
      let key = p.key
      for (let i = 2; db.prepare('SELECT 1 FROM soloyard_projects WHERE key = ?').get(key); i++) key = `${p.key}${i}`
      const meta = { ...(p.meta_json ? JSON.parse(p.meta_json) : {}), legacy: { db: legacyPath, id: p.id } }
      const pid = add('projects', { ...pick(p, ['name', 'goal', 'stage', 'archived', 'next_step', 'stoploss_json', 'issue_seq', 'created_at', 'updated_at', 'version']), key, meta_json: JSON.stringify(meta) })
      for (const pp of all('SELECT * FROM project_paths WHERE project_id = ?', p.id)) {
        // 新库里已经有项目用这个目录了，就不抢
        if (db.prepare('SELECT 1 FROM soloyard_project_paths WHERE path = ?').get(pp.path)) continue
        add('project_paths', { project_id: pid, path: pp.path, recursive: pp.recursive ?? 1 })
      }
      const withProject = (table: string, oldTable: string, cols: string[]) => {
        const map = new Map<number, number>()
        if (!has(oldTable)) return map
        for (const r of all(`SELECT * FROM ${oldTable} WHERE project_id = ?`, p.id)) map.set(r.id, add(table, { ...pick(r, cols), project_id: pid }))
        return map
      }
      const stamp = ['created_at', 'updated_at', 'version']
      withProject('ideas', 'ideas', ['title', 'body_md', 'status', 'reject_reason', 'source', 'snooze_until', ...stamp])
      withProject('documents', 'documents', ['kind', 'slug', 'title', 'body_md', 'blocks_json', ...stamp])
      withProject('decisions', 'decisions', ['code', 'title', 'door', 'status', 'data_json', ...stamp])
      withProject('evidence', 'evidence', ['code', 'level', 'verified', 'data_json'])
      const features = withProject('features', 'features', ['code', 'backbone', 'module', 'name', 'layer', 'level', 'tier', 'choice', 'data_json', ...stamp])
      const milestones = withProject('milestones', 'milestones', ['name', 'target_date', 'done', ...stamp])
      const cycles = withProject('cycles', 'iterations', ['name', 'start_date', 'end_date', 'status', ...stamp])
      const issues = new Map<number, number>()
      const oldIssues = all('SELECT * FROM issues WHERE project_id = ? ORDER BY id', p.id)
      for (const i of oldIssues) {
        issues.set(i.id, add('issues', {
          ...pick(i, ['number', 'title', 'body_md', 'status', 'priority', 'labels', 'due_date', 'sort_key', 'completed_at', ...stamp]),
          project_id: pid,
          cycle_id: cycles.get(i.iteration_id) ?? null,
          milestone_id: milestones.get(i.milestone_id) ?? null,
          feature_id: features.get(i.feature_id) ?? null,
        }))
      }
      // 父子关系第二遍补：父 issue 可能排在子 issue 后面
      for (const i of oldIssues) {
        if (i.parent_id && issues.has(i.parent_id)) db.prepare('UPDATE soloyard_issues SET parent_id = ? WHERE id = ?').run(issues.get(i.parent_id)!, issues.get(i.id)!)
      }
      const ids = [...issues.keys()]
      if (ids.length) {
        const inIssues = `(${ids.map(() => '?').join(',')})`
        for (const d of all(`SELECT * FROM issue_deps WHERE issue_id IN ${inIssues}`, ...ids)) {
          if (issues.has(d.blocked_by_id)) add('issue_deps', { issue_id: issues.get(d.issue_id)!, blocked_by_id: issues.get(d.blocked_by_id)! })
        }
        for (const a of all(`SELECT * FROM acceptance WHERE issue_id IN ${inIssues}`, ...ids)) add('acceptance', { issue_id: issues.get(a.issue_id)!, text: a.text, done: a.done, sort: a.sort })
        if (has('comments')) for (const c of all(`SELECT * FROM comments WHERE issue_id IN ${inIssues}`, ...ids)) add('comments', { issue_id: issues.get(c.issue_id)!, actor: c.actor, body_md: c.body_md, created_at: c.created_at })
      }
    }
    // 收件箱里没挂项目的想法：只在第一次导入时搬
    if (!imported.size && has('ideas')) {
      for (const i of all('SELECT * FROM ideas WHERE project_id IS NULL')) {
        add('ideas', pick(i, ['title', 'body_md', 'status', 'reject_reason', 'source', 'snooze_until', 'created_at', 'updated_at', 'version']))
      }
    }
    // 导入不走 insert()，补一条变更记录让打开着的界面刷新
    if (Object.keys(counts).length) {
      db.prepare("INSERT INTO soloyard_changes (at, actor, entity, entity_id, op, after_json) VALUES (?, 'system', 'import', 0, 'create', ?)").run(new Date().toISOString(), JSON.stringify({ from: legacyPath, counts }))
    }
  })
  old.close()
  return { counts, skipped }
}

// 直接运行：node import-legacy.ts <原型库> <Soloyard 库>
if (import.meta.main) {
  const { openDb } = await import('./db.ts')
  const [legacy, target] = process.argv.slice(2)
  if (!legacy || !target) {
    process.stderr.write('usage: node import-legacy.ts <indie-desk.db> <monocode.db>\n')
    process.exit(2)
  }
  console.log(JSON.stringify(importLegacy(openDb(target), legacy), null, 2))
}
