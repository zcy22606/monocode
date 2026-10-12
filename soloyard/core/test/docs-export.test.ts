import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { docFileName, exportDocuments } from '../src/docs-export.ts'

test('文档表一次性导出成项目 docs/ 下的文件：md / 块 json、不覆盖、不重复、没路径的跳过', () => {
  const root = mkdtempSync(join(tmpdir(), 'soloyard-docs-'))
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'app', path: root })
  r.addDocument(db, 'user', pid, { title: '想法卡', body_md: '# 想法卡\n见 D-1' })
  r.addDocument(db, 'user', pid, { title: 'a/b: c?', body_md: 'x' })
  const sections = [{ id: 's0', title: '结论', blocks: [{ type: 'text', text: '先做' }] }]
  r.insert(db, 'user', 'documents', { project_id: pid, slug: '01-立项', title: '立项卡', blocks_json: JSON.stringify({ meta: ['日期'], sections }) })
  // 同名文件：内容不同 → 不覆盖，写成「名字-<id>」
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/竞品.md'), '用户自己的')
  const clash = r.addDocument(db, 'user', pid, { title: '竞品', body_md: '库里的' })
  // 路径不存在的项目跳过并记日志
  const orphan = r.createProject(db, 'user', { name: 'gone', path: join(root, 'missing') })
  r.addDocument(db, 'user', orphan, { title: 'lost', body_md: 'x' })
  const logs: string[] = []

  const { written } = exportDocuments(db, (m) => logs.push(m))
  assert.equal(written.length, 4)
  const docs = join(root, 'docs')
  assert.equal(readFileSync(join(docs, '想法卡.md'), 'utf8'), '# 想法卡\n见 D-1\n')
  assert.equal(readFileSync(join(docs, 'a-b- c-.md'), 'utf8'), 'x\n')
  assert.deepEqual(JSON.parse(readFileSync(join(docs, '立项卡.json'), 'utf8')), { id: '01-立项', title: '立项卡', meta: ['日期'], sections })
  assert.equal(readFileSync(join(docs, '竞品.md'), 'utf8'), '用户自己的')
  assert.equal(readFileSync(join(docs, `竞品-${clash}.md`), 'utf8'), '库里的\n')
  assert.equal(logs.length, 1)
  assert.match(logs[0], /no existing project folder/)
  assert.ok(!existsSync(join(root, 'missing')))

  // 再跑一次：导过的不再写，用户删掉的文件也不会冒出来；之后新进表的补导
  rmSync(join(docs, '想法卡.md'))
  r.addDocument(db, 'user', pid, { title: '新的', body_md: 'n' })
  assert.deepEqual(exportDocuments(db).written, [join(docs, '新的.md')])
  assert.ok(!readdirSync(docs).includes('想法卡.md'))
  // 导出标记不进变更日志（撤销撤不掉）
  assert.ok(!db.prepare("SELECT 1 FROM soloyard_changes WHERE entity = 'projects' AND op = 'update'").get())
})

test('文件名清洗', () => {
  assert.equal(docFileName('  ..Hello / World. ', 3), 'Hello - World')
  assert.equal(docFileName('***', 7), 'doc-7')
})
