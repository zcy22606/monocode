import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db.ts'
import type { Row } from './repo.ts'

/** 文档标题 → 文件名：去掉路径和文件系统不认的字符，空了用 doc-<id>。 */
export function docFileName(title: string, id: number) {
  const base = String(title ?? '').replace(/[/\\:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[\s.]+$/g, '').slice(0, 80)
  return base || `doc-${id}`
}

/**
 * 一篇文档写成什么：有正文就是 .md；只有块（product-thinking 导入的）就原样导成 SCHEMA 的 docs/*.json（id + title + meta / lead / sections），
 * Docs 页的块渲染器直接认；两样都没有就只写个标题。
 */
export function documentFile(doc: Row): { ext: '.md' | '.json'; content: string } {
  if (doc.body_md?.trim()) return { ext: '.md', content: doc.body_md.endsWith('\n') ? doc.body_md : `${doc.body_md}\n` }
  let blocks: Row | null = null
  try { blocks = JSON.parse(doc.blocks_json ?? 'null') } catch { /* 坏 JSON 当没有 */ }
  if (blocks && typeof blocks === 'object' && Object.values(blocks).some((v) => v != null && (!Array.isArray(v) || v.length))) {
    return { ext: '.json', content: `${JSON.stringify({ id: doc.slug ?? `doc-${doc.id}`, title: doc.title, ...blocks }, null, 2)}\n` }
  }
  return { ext: '.md', content: `# ${doc.title}\n` }
}

/**
 * 一次性把 soloyard_documents 里的文档导出成项目根目录 docs/ 下的文件（文档以项目文件夹为准，数据库不再存正文）。
 * - 导出过的文档 id 记在项目 meta_json.exported_docs，不重复导（用户删了文件也不会再冒出来）；之后新进表的（头脑风暴提升还在写）下次启动补导。
 * - 同名文件已存在：内容一样算导过；不一样不覆盖，改写成「名字-<id>」，那个也有就跳过。
 * - 项目没有路径或路径不存在：跳过、记日志，不记已导出，路径有了以后下次启动再导。
 * 直接改 meta_json、不走 update()：不进变更日志，撤销不会把它撤掉。
 */
export function exportDocuments(db: DB, log: (msg: string) => void = () => {}) {
  const written: string[] = []
  const projects = db.prepare('SELECT DISTINCT p.id, p.key, p.meta_json FROM soloyard_projects p JOIN soloyard_documents d ON d.project_id = p.id').all() as Row[]
  for (const p of projects) {
    const meta = p.meta_json ? JSON.parse(p.meta_json) : {}
    const done = new Set<number>(meta.exported_docs ?? [])
    const docs = (db.prepare('SELECT * FROM soloyard_documents WHERE project_id = ? ORDER BY id').all(p.id) as Row[]).filter((d) => !done.has(d.id))
    if (!docs.length) continue
    const root = (db.prepare('SELECT path FROM soloyard_project_paths WHERE project_id = ? ORDER BY rowid').all(p.id) as Row[]).map((r) => r.path).find((x) => existsSync(x))
    if (!root) {
      log(`soloyard: ${p.key} has ${docs.length} document(s) to export but no existing project folder; skipped`)
      continue
    }
    const dir = join(root, 'docs')
    mkdirSync(dir, { recursive: true })
    for (const d of docs) {
      const { ext, content } = documentFile(d)
      const name = docFileName(d.title, d.id)
      for (const file of [join(dir, name + ext), join(dir, `${name}-${d.id}${ext}`)]) {
        if (existsSync(file)) {
          if (readFileSync(file, 'utf8') !== content) continue
        } else {
          writeFileSync(file, content, { flag: 'wx' })
          written.push(file)
        }
        done.add(d.id)
        break
      }
      if (!done.has(d.id)) log(`soloyard: ${p.key} document ${d.id} "${d.title}" not exported: ${name}${ext} already exists with other content`)
    }
    db.prepare('UPDATE soloyard_projects SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...meta, exported_docs: [...done] }), p.id)
  }
  return { written }
}
