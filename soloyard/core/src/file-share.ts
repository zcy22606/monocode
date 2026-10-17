/**
 * Soloyard：手机要看会话里的文件时，在文件所在的机器上（电脑的数据进程 / 主机的网关）读出来（SOL-92）。
 * 只给两种文件：会话目录（项目根目录、工作树）里的，会话里出现过完整路径的；网页文件出现过的话，它所在的文件夹也给（页面要加载样式、脚本、图片）。
 * 凭据类文件一律不给，单个最大 50 MB。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname } from 'node:path'
import { absolutePath } from './session-files.ts'

export const MAX_FILE = 50 << 20

const SECRET = [
  /(^|\/)\.env(\.[^/]*)?$/,
  /\.secrets?(\.[^/]*)?$/i,
  /(^|\/)\.(ssh|gnupg|aws|kube|docker)\//,
  /(^|\/)\.config\/gh\//,
  /(^|\/)\.codex\/auth\.json$/,
  /(^|\/)\.claude\/\.credentials\.json$/,
  /(^|\/)(\.netrc|\.git-credentials|\.npmrc|\.pypirc)$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)credentials(\.json)?$/i,
]
export const isSecret = (path: string) => SECRET.some((re) => re.test(path))

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', xml: 'application/xml',
  pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
/** 代码、日志这些没列出来的文本按纯文本给，手机上能直接看。 */
const TEXT = /^(ts|tsx|jsx|rs|py|go|java|kt|swift|c|h|cpp|hpp|rb|php|sh|zsh|bash|toml|yaml|yml|ini|conf|log|sql|vue|svelte|lua|dart|scss|less|mmd|jsonl|ndjson|lock|gitignore)$/
export function mimeOf(path: string) {
  const ext = extname(path).slice(1).toLowerCase()
  return MIME[ext] ?? (TEXT.test(ext) || !ext ? 'text/plain' : 'application/octet-stream')
}

export type ShareContext = { cwd: string; worktreeCwd?: string | null; blocksJson: string }
export type SharedFile = { name: string; mime: string; size: number; mtime: number; path: string; data?: Buffer }

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
const under = (path: string, root: string) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** 会话里出现过的网页文件所在的文件夹（不含 home 和它上面的目录，免得整个 home 都能读）。 */
function pageRoots(blocksJson: string, home: string) {
  const roots: string[] = []
  for (const m of blocksJson.matchAll(/(?:~|\/)[^"\s\\<>|*?]*?\.html?\b/g)) {
    const dir = dirname(absolutePath(m[0], '/', home))
    if (!under(home, dir)) roots.push(dir)
  }
  return roots
}

/** knownMtime 和文件一样（手机缓存的没变）就不带内容。 */
export function readSharedFile(raw: string, ctx: ShareContext, knownMtime?: number): SharedFile {
  const home = homedir()
  const asked = absolutePath(raw, ctx.worktreeCwd || ctx.cwd, home)
  const file = real(asked)
  if (isSecret(asked) || isSecret(file)) throw new Error('Credential files are not shared')
  const tilde = under(asked, home) ? `~${asked.slice(home.length)}` : asked
  const mentioned = ctx.blocksJson.includes(JSON.stringify(asked).slice(1, -1)) || ctx.blocksJson.includes(JSON.stringify(tilde).slice(1, -1))
  const roots = [ctx.cwd, ctx.worktreeCwd, ...pageRoots(ctx.blocksJson, home)].filter((r): r is string => !!r).map(real)
  if (!mentioned && !roots.some((r) => under(file, r))) throw new Error('This file is not part of the session')
  let stat
  try {
    stat = statSync(file)
  } catch {
    throw new Error('File not found')
  }
  if (!stat.isFile()) throw new Error('Not a file')
  if (stat.size > MAX_FILE) throw new Error('File is larger than 50 MB')
  const meta = { name: basename(file), mime: mimeOf(file), size: stat.size, mtime: Math.floor(stat.mtimeMs), path: asked }
  return knownMtime === meta.mtime ? meta : { ...meta, data: readFileSync(file) }
}
