/**
 * Soloyard：同一个仓库在 Mac 和家里主机上的路径不一样（/Users/x/Workspace/openroboto、/home/x/openroboto），
 * 会话镜像按「仓库身份」对上：git 远程 origin 归一化成 host/path（不分协议、去掉用户名和 .git），
 * 没有远程（不是 git 仓库、多仓库项目的根目录）就用文件夹名。工作树和主检出的 origin 一样，身份也一样。
 */
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

/** git@github.com:a/b.git、https://user@github.com/a/b、ssh://git@github.com/a/b.git → github.com/a/b */
export function normalizeRemote(url: string): string {
  let s = url.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '')
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(s)
  if (scp) s = `${scp[1]}/${scp[2]}`
  else s = s.replace(/^[a-z+]+:\/\//i, '').replace(/^[^/@]+@/, '')
  const [host, ...rest] = s.split('/')
  return [host.toLowerCase().replace(/:\d+$/, ''), ...rest].join('/')
}

const cache = new Map<string, { key: string; at: number }>()

export function repoKey(cwd: string): string {
  const hit = cache.get(cwd)
  // ponytail: 缓存一分钟，换了远程地址的极少情况晚一分钟生效
  if (hit && Date.now() - hit.at < 60_000) return hit.key
  let key = `dir:${basename(cwd.replace(/\/+$/, ''))}`
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
    if (url.trim()) key = normalizeRemote(url)
  } catch {
    // 不是 git 仓库或没有 origin：用文件夹名
  }
  cache.set(cwd, { key, at: Date.now() })
  return key
}
