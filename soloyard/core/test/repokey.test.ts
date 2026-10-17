import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { normalizeRemote, repoKey } from '../src/repokey.ts'

test('仓库身份：不同写法的同一个远程地址对得上，没有远程用文件夹名', () => {
  const want = 'github.com/zcy22606/monocode'
  for (const url of [
    'git@github.com:zcy22606/monocode.git',
    'https://github.com/zcy22606/monocode.git',
    'https://user@GitHub.com/zcy22606/monocode/',
    'ssh://git@github.com:22/zcy22606/monocode.git',
  ])
    assert.equal(normalizeRemote(url), want, url)

  const plain = mkdtempSync(join(tmpdir(), 'repokey-'))
  assert.equal(repoKey(plain), `dir:${plain.split('/').pop()}`)

  const repo = mkdtempSync(join(tmpdir(), 'repokey-git-'))
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:zcy22606/monocode.git'])
  assert.equal(repoKey(repo), want)
})
