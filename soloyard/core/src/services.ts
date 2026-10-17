/**
 * Soloyard：手机上打开电脑 / 主机上跑着的本地服务（开发服务器，SOL-97）。
 * 列出会话目录里的进程在监听的端口；手机要打开哪个，才在本机的 Tailscale 地址上开一个同端口的转发
 * （只有自己 tailnet 里的设备连得上），转发的是 TCP，热更新的 WebSocket 照样通。闲置 30 分钟关掉。
 */
import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)
export const IDLE = 30 * 60_000

export type Listener = { pid: number; command: string; host: string; port: number; cwd?: string }
export type Service = { port: number; command: string; pid: number }

/** `127.0.0.1:5173`、`*:3000`、`[::1]:8080` → 地址和端口。 */
function hostPort(addr: string) {
  const at = addr.lastIndexOf(':')
  return { host: addr.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(addr.slice(at + 1)) }
}

/** macOS：`lsof -nP -iTCP -sTCP:LISTEN -Fpcn` 的输出（p 进程、c 命令、n 地址）。 */
export function parseLsof(out: string): Listener[] {
  const found: Listener[] = []
  let pid = 0
  let command = ''
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'c') command = line.slice(1)
    else if (line[0] === 'n') found.push({ pid, command, ...hostPort(line.slice(1)) })
  }
  return found
}

/** Linux：`ss -ltnpH` 的输出，进程在 users:(("node",pid=123,fd=20)) 里。 */
export function parseSs(out: string): Listener[] {
  const found: Listener[] = []
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/)
    const user = /\(\("([^"]+)",pid=(\d+)/.exec(line)
    if (cols.length < 4 || !user) continue
    found.push({ pid: Number(user[2]), command: user[1], ...hostPort(cols[3]) })
  }
  return found
}

/** 本机所有在监听的 TCP 端口和监听进程的工作目录。 */
export async function listeners(): Promise<Listener[]> {
  if (process.platform === 'linux') {
    const found = parseSs((await run('ss', ['-ltnpH'])).stdout)
    for (const l of found) l.cwd = await readlink(`/proc/${l.pid}/cwd`).catch(() => undefined)
    return found
  }
  const found = parseLsof((await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']).catch((e) => e)).stdout ?? '')
  const pids = [...new Set(found.map((l) => l.pid))]
  if (!pids.length) return found
  // lsof 找不到其中某个进程时退出码非 0，输出照样有用
  const cwds = (await run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]).catch((e) => e)).stdout ?? ''
  const cwd = new Map<number, string>()
  let pid = 0
  for (const line of String(cwds).split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n') cwd.set(pid, line.slice(1))
  }
  for (const l of found) l.cwd = cwd.get(l.pid)
  return found
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)

/** 对话里提到过的本地网址的端口（agent 回复里写了 http://127.0.0.1:8765）：在项目外起的服务也算这个会话的。 */
export function mentionedPorts(text: string) {
  return new Set([...text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})/gi)].map((m) => Number(m[1])))
}

/**
 * 这个会话的服务：会话目录里的进程在监听的，加上对话里提到过的端口（不含系统端口和自己）。
 * 只有这些能打开，电脑上别的本地服务不会被手机开出去。
 */
export function projectListeners(all: Listener[], roots: string[], mentioned = new Set<number>()) {
  return all.filter((l) => l.port >= 1024 && l.pid !== process.pid && (mentioned.has(l.port) || (!!l.cwd && roots.some((r) => under(l.cwd!, r)))))
}

/** 只在本机地址上听的连 127.0.0.1 还是 ::1。 */
const loopback = (mine: Listener[]) => (mine.some((l) => l.host !== '::1' && l.host !== '[::1]') ? '127.0.0.1' : '::1')

/**
 * 这个端口说不说 HTTP：回了 HTTP 是；先说了别的（模拟器控制台这类）或者直接断开不是；
 * 一直不吭声的算 silent（adb 这类守护进程，也可能是第一次访问要先编译的开发服务器）。
 */
export function probe(port: number, host: string, timeout = 800): Promise<'http' | 'other' | 'silent'> {
  return new Promise((ok) => {
    const s = createConnection(port, host)
    const done = (answer: 'http' | 'other' | 'silent') => (s.destroy(), ok(answer))
    s.setTimeout(timeout, () => done('silent'))
    s.once('connect', () => s.write('HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n'))
    s.once('data', (d) => done(String(d).startsWith('HTTP/') ? 'http' : 'other'))
    s.once('end', () => done('other'))
    s.once('error', () => done('other'))
  })
}

/** 不吭声时，是这些运行时起的才算开发服务器（Next.js 第一次访问要先编译，几秒才回）。 */
const RUNTIMES = /^(node|bun|deno|python[\d.]*|ruby|php|java|go|uvicorn|gunicorn|dotnet|next-server)$/i

/** 给手机列的：这个会话的服务里说 HTTP 的端口（同一个端口 IPv4 / IPv6 各一条，合成一条）。 */
export async function projectServices(all: Listener[], roots: string[], mentioned?: Set<number>): Promise<Service[]> {
  const mine = projectListeners(all, roots, mentioned)
  const ports = [...new Set(mine.map((l) => l.port))].sort((a, b) => a - b)
  const found = await Promise.all(
    ports.map(async (port) => {
      const on = mine.filter((l) => l.port === port)
      const answer = await probe(port, loopback(on))
      return answer === 'http' || (answer === 'silent' && RUNTIMES.test(on[0].command)) ? { port, command: on[0].command, pid: on[0].pid } : undefined
    }),
  )
  return found.filter((s): s is Service => !!s)
}

/** 本机的 Tailscale 地址（100.64.0.0/10）。 */
export function tailscaleIp() {
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) return a.address
  return undefined
}

type Forward = { server: Server; open: Set<Socket>; used: number }
const forwards = new Map<number, Forward>()

/**
 * 让手机能连上这个端口（listening 传 projectListeners 的结果）：本来就在所有地址上监听的，直接给 Tailscale 地址；
 * 只在本机地址上的，在 Tailscale 地址的同一个端口上开转发。返回手机要打开的地址。
 */
export async function openService(port: number, listening: Listener[], ip = tailscaleIp(), idle = IDLE): Promise<{ url: string }> {
  if (!ip) throw new Error('Tailscale is not running on this computer')
  const url = `http://${ip}:${port}`
  const mine = listening.filter((l) => l.port === port)
  if (!mine.length) throw new Error('Nothing in this project is listening on this port')
  if (mine.some((l) => l.host === '*' || l.host === '0.0.0.0' || l.host === '::' || l.host === ip)) return { url }
  const known = forwards.get(port)
  if (known) {
    known.used = Date.now()
    return { url }
  }
  const target = loopback(mine)
  const entry: Forward = { server: createServer(), open: new Set(), used: Date.now() }
  entry.server.on('connection', (socket) => {
    entry.used = Date.now()
    entry.open.add(socket)
    const upstream = createConnection(port, target)
    socket.pipe(upstream).pipe(socket)
    const done = () => {
      entry.open.delete(socket)
      entry.used = Date.now()
      socket.destroy()
      upstream.destroy()
    }
    socket.on('close', done).on('error', done)
    upstream.on('close', done).on('error', done)
  })
  const bound = await new Promise<boolean>((ok, fail) => {
    entry.server.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? ok(false) : fail(e)))
    entry.server.listen(port, ip, () => ok(true))
  })
  // 这个地址上已经有人在听（服务自己绑了 Tailscale 地址）：直接用
  if (!bound) return { url }
  forwards.set(port, entry)
  const timer = setInterval(() => {
    if (entry.open.size || Date.now() - entry.used < idle) return
    clearInterval(timer)
    entry.server.close()
    forwards.delete(port)
  }, Math.min(60_000, idle)).unref()
  entry.server.unref()
  return { url }
}

/** 测试和退出时用：关掉所有转发。 */
export function closeForwards() {
  for (const f of forwards.values()) {
    for (const s of f.open) s.destroy()
    f.server.close()
  }
  forwards.clear()
}
