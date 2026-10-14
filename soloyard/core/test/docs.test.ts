import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import * as r from '../src/repo.ts'
import { addProjectRepo } from '../src/repos.ts'
import { docState, fileTitle, listDocs, newDoc, parseHeader } from '../src/docs.ts'

const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

test('文件头：列表、表格、front matter 三种写法；只看第一个 ## 之前', () => {
  assert.deepEqual(parseHeader('# ADR 02：续训方法\n\n- 日期：2026-10-14 01:10（UTC+8）\n- 状态：**部分被 ADR 03 取代**\n- 关联：ADR 01、reports 03\n\n## 背景\n- 状态：不算'), {
    title: 'ADR 02：续训方法', date: '2026-10-14 01:10（UTC+8）', status: '部分被 ADR 03 取代', related: 'ADR 01、reports 03',
  })
  assert.deepEqual(parseHeader('# ADR 03 — 赛事\n\n| | |\n|---|---|\n| **日期** | 2026-08-24 |\n| **状态** | 已确认（Cameron 拍板） |'), {
    title: 'ADR 03 — 赛事', date: '2026-08-24', status: '已确认（Cameron 拍板）',
  })
  assert.deepEqual(parseHeader('---\nstatus: draft\ndate: "2026-09-01"\n---\n# Spec'), { status: 'draft', date: '2026-09-01', title: 'Spec' })
})

test('状态归类只看开头一句', () => {
  assert.equal(docState('已确认（2026-08-26 复核：结论不变）'), 'confirmed')
  assert.equal(docState('**部分被 ADR 02 取代**（10-14）：起点改为…'), 'partial')
  assert.equal(docState('已废弃 → 看 runbooks/01'), 'superseded')
  assert.equal(docState('10-14 08:55 更新。根因找到一半；剩下的已确认'), null, '后面句子里的「已确认」不算')
  assert.equal(docState('已归档（superseded） —— 不要按本文动手'), 'archived', '取最先出现的词')
  assert.equal(docState('In force. Steps were checked against the repo'), 'confirmed')
  assert.equal(docState(undefined), null)
})

test('列出根目录和成员仓库的 docs/：类型、编号、日期退回文件时间、凭据和隐藏目录不列', () => {
  const root = mkdtempSync(join(tmpdir(), 'soloyard-docs-'))
  const backend = join(root, 'rebuild', 'backend')
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'Robo', path: root })
  mkdirSync(backend, { recursive: true })
  addProjectRepo(db, 'user', pid, backend, '后端')

  put(join(root, 'docs', 'runbooks', '01-接手手册.md'), '# 接手手册\n\n- 日期：2026-08-07\n- 状态：已确认\n')
  put(join(root, 'docs', 'handover', 'HANDOVER-OPS.md'), '# 部署与运维问题\n')
  put(join(root, 'docs', 'overview.md'), '# 概览\n')
  put(join(root, 'docs', '.trellis', 'x.md'), '# 工具的\n')
  put(join(root, 'docs', 'cutover.secrets.local.md'), '# 凭据\n')
  put(join(backend, 'docs', 'adr', '03-赛事作为一等实体.md'), '# ADR 03 — 赛事\n\n| **日期** | 2026-08-24 |\n| **状态** | 已确认 |\n')
  put(join(backend, 'docs', 'archive', 'START-HERE.md'), '# 从这里开始\n')
  put(join(backend, 'docs', 'reports', '03-审计', '00-总览.md'), '# 总览\n')

  const docs = listDocs(db, join(backend, 'src'))
  const pick = (rel: string) => docs.find((d) => d.rel === rel)!
  assert.deepEqual(docs.map((d) => d.rel), ['adr/03-赛事作为一等实体.md', 'reports/03-审计/00-总览.md', 'runbooks/01-接手手册.md', 'archive/START-HERE.md', 'handover/HANDOVER-OPS.md', 'overview.md'])
  assert.deepEqual([pick('adr/03-赛事作为一等实体.md').repoName, pick('adr/03-赛事作为一等实体.md').no, pick('adr/03-赛事作为一等实体.md').state], ['backend', '03', 'confirmed'])
  assert.equal(pick('reports/03-审计/00-总览.md').no, '03', '编号文件夹里的文档算这个编号')
  assert.deepEqual([pick('runbooks/01-接手手册.md').repo, pick('runbooks/01-接手手册.md').date, pick('runbooks/01-接手手册.md').dateFrom], [null, '2026-08-07', 'header'])
  assert.deepEqual([pick('handover/HANDOVER-OPS.md').type, pick('handover/HANDOVER-OPS.md').dateFrom, pick('handover/HANDOVER-OPS.md').state], [null, 'file', null], '不在类型目录 = 未归类')
  assert.equal(pick('archive/START-HERE.md').state, 'archived', 'archive/ 里没写状态的算已归档')
  assert.equal(pick('overview.md').auto, true)
})

test('新建文档：编号续上、文件头写好、仓库按名字找、类型不对就拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'soloyard-newdoc-'))
  const backend = join(root, 'backend')
  const db = openDb(':memory:')
  const pid = r.createProject(db, 'user', { name: 'Robo', path: root })
  mkdirSync(backend)
  addProjectRepo(db, 'user', pid, backend, '后端')
  put(join(backend, 'docs', 'adr', '06-赛事配置.md'), '# x\n')

  const made = newDoc(db, root, { type: 'adr', title: '真机提交费 按赛事配置', repo: 'backend', author: 'claude', related: 'OPE-45、ADR 06' })
  assert.equal(made.code, 'adr/07')
  assert.equal(made.path, join(backend, 'docs', 'adr', '07-真机提交费按赛事配置.md'))
  assert.equal(readFileSync(made.path, 'utf8'), `# ADR 07：真机提交费 按赛事配置\n\n- 日期：${new Date().toLocaleDateString('sv-SE')}\n- 状态：草稿\n- 作者：claude\n- 关联：OPE-45、ADR 06\n\n`)

  const charter = newDoc(db, root, { type: 'product', title: '立项卡', kind: 'json' })
  assert.equal(charter.path, join(root, 'docs', 'product', '01-立项卡.json'), '不传仓库 = 根目录')
  assert.equal(JSON.parse(readFileSync(charter.path, 'utf8')).meta.status, '草稿')
  assert.equal(newDoc(db, root, { type: 'product', title: '功能全集' }).code, 'product/02')

  assert.throws(() => newDoc(db, root, { type: 'notes', title: 'x' }), /类型只能是/)
  assert.throws(() => newDoc(db, root, { type: 'archive', title: 'x' }), /归档/)
  assert.throws(() => newDoc(db, root, { type: 'specs', title: 'x', repo: 'web' }), /找不到仓库 web/)
  assert.equal(fileTitle('π0.5 下线与强制新 CLI'), 'π0.5下线与强制新CLI')
  assert.equal(fileTitle('btc trend: flow'), 'btc-trend-flow')
})
