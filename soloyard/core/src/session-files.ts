/**
 * Soloyard：会话里写过、改过、生成过的文件（手机上会话的「文件」列表，SOL-92）。
 * 纯函数，不碰 node：网关（电脑上的会话）和手机（服务器上的会话）都用这一份。
 */
type Preview = { kind?: string; path?: string }
type FileBlock = {
  role?: string
  startedAt?: number
  tool?: { preview?: Preview }
  agentRun?: { steps?: { preview?: Preview }[] }
  image?: { path?: string }
  attachments?: { path?: string }[]
}
export type SessionFile = { path: string; kind: 'write' | 'image' | 'attachment'; at: number }

/** 相对路径按会话目录算，~/ 换成 home；顺手去掉 . 和 ..。 */
export function absolutePath(path: string, base: string, home?: string) {
  // 不知道 home（网关替电脑列文件）就原样留着，到电脑上读的时候再展开
  if (path.startsWith('~/') && !home) return path
  const full = path.startsWith('~/') && home ? home + path.slice(1) : path.startsWith('/') ? path : `${base}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** 新的在前；同一个文件只留最后一次。 */
export function sessionFiles(blocks: FileBlock[], base: string, home?: string): SessionFile[] {
  const files = new Map<string, SessionFile>()
  const add = (path: string | undefined, kind: SessionFile['kind'], at: number) => {
    if (!path) return
    const abs = absolutePath(path, base, home)
    files.delete(abs)
    files.set(abs, { path: abs, kind, at })
  }
  for (const b of blocks) {
    const at = b.startedAt ?? 0
    if (b.tool?.preview?.kind === 'write') add(b.tool.preview.path, 'write', at)
    for (const step of b.agentRun?.steps ?? []) if (step.preview?.kind === 'write') add(step.preview.path, 'write', at)
    add(b.image?.path, 'image', at)
    if (b.role === 'user') for (const a of b.attachments ?? []) add(a.path, 'attachment', at)
  }
  return [...files.values()].reverse()
}
