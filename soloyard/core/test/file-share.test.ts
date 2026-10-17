import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mimeOf, readSharedFile } from '../src/file-share.ts'
import { absolutePath, sessionFiles } from '../src/session-files.ts'

test('会话的文件清单：写过的、生成的图片、用户发的附件，相对路径按会话目录算，新的在前、不重复', () => {
  const blocks = [
    { role: 'tool', startedAt: 1, tool: { preview: { kind: 'write', path: 'src/a.ts' } } },
    { role: 'tool', startedAt: 2, tool: { preview: { kind: 'read', path: 'src/b.ts' } } },
    { role: 'image', startedAt: 3, image: { path: '/tmp/gen/cat.png' } },
    { role: 'user', startedAt: 4, attachments: [{ path: '~/Downloads/brief.pdf' }, {}] },
    { role: 'tool', startedAt: 5, tool: { preview: { kind: 'write', path: '/repo/src/a.ts' } } },
    { role: 'tool', startedAt: 6, agentRun: { steps: [{ preview: { kind: 'write', path: './docs/../README.md' } }] } },
  ]
  assert.deepEqual(sessionFiles(blocks, '/repo', '/Users/me'), [
    { path: '/repo/README.md', kind: 'write', at: 6 },
    { path: '/repo/src/a.ts', kind: 'write', at: 5 },
    { path: '/Users/me/Downloads/brief.pdf', kind: 'attachment', at: 4 },
    { path: '/tmp/gen/cat.png', kind: 'image', at: 3 },
  ])
  assert.equal(absolutePath('../../../etc/passwd', '/repo/a'), '/etc/passwd')
})

test('取文件：会话目录里的、会话里出现过的给；别处的、凭据不给；没变就不带内容', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'share-')))
  const repo = join(root, 'repo')
  const outside = join(root, 'outside')
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(outside, 'site'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'export {}')
  writeFileSync(join(repo, '.env'), 'TOKEN=x')
  writeFileSync(join(repo, 'prod.secrets.json'), '{}')
  writeFileSync(join(outside, 'report.pdf'), '%PDF')
  writeFileSync(join(outside, 'other.txt'), 'nope')
  writeFileSync(join(outside, 'site/index.html'), '<link href="style.css">')
  writeFileSync(join(outside, 'site/style.css'), 'body{}')
  const ctx = { cwd: repo, blocksJson: JSON.stringify([{ text: `看 ${outside}/report.pdf 和 ${outside}/site/index.html` }]) }

  const a = readSharedFile('src/a.ts', ctx)
  assert.equal(a.data?.toString(), 'export {}')
  assert.equal(a.mime, 'text/plain')
  assert.equal(readSharedFile(join(outside, 'report.pdf'), ctx).mime, 'application/pdf')
  // 网页出现过：同一个文件夹里的样式也给
  assert.equal(readSharedFile(join(outside, 'site/style.css'), ctx).data?.toString(), 'body{}')
  assert.throws(() => readSharedFile(join(outside, 'other.txt'), ctx), /not part of the session/)
  assert.throws(() => readSharedFile('../outside/other.txt', ctx), /not part of the session/)
  assert.throws(() => readSharedFile('.env', ctx), /Credential/)
  assert.throws(() => readSharedFile('prod.secrets.json', ctx), /Credential/)
  assert.throws(() => readSharedFile('src', ctx), /Not a file/)
  assert.throws(() => readSharedFile('src/missing.ts', ctx), /not found/)

  utimesSync(join(repo, 'src/a.ts'), 1_700_000_000, 1_700_000_000)
  const same = readSharedFile('src/a.ts', ctx, 1_700_000_000_000)
  assert.equal(same.data, undefined)
  assert.equal(same.size, 9)
  assert.equal(mimeOf('x.unknownext'), 'application/octet-stream')
})
