import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'
import { test } from 'node:test'
import { closeForwards, mentionedPorts, openService, parseLsof, parseSs, projectListeners, projectServices, type Listener } from '../src/services.ts'

test('本地服务：解析 lsof / ss，只列会话目录里的进程，同端口合并', () => {
  const mac = parseLsof('p101\ncnode\nf20\nn127.0.0.1:5173\nf21\nn[::1]:5173\np202\ncpython3\nf3\nn*:8000\np303\ncsshd\nf4\nn*:22\n')
  assert.deepEqual(mac.map((l) => [l.pid, l.command, l.host, l.port]), [
    [101, 'node', '127.0.0.1', 5173], [101, 'node', '::1', 5173], [202, 'python3', '*', 8000], [303, 'sshd', '*', 22],
  ])
  const linux = parseSs('LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=101,fd=20))\nLISTEN 0 128 [::]:3000 [::]:* users:(("next-server",pid=7,fd=3))\n')
  assert.deepEqual(linux.map((l) => [l.pid, l.command, l.host, l.port]), [[101, 'node', '127.0.0.1', 5173], [7, 'next-server', '::', 3000]])

  const cwd: Record<number, string> = { 101: '/repo/web', 202: '/elsewhere', 303: '/' }
  for (const l of mac) l.cwd = cwd[l.pid]
  assert.deepEqual(projectListeners(mac, ['/repo']).map((l) => l.port), [5173, 5173])
  assert.deepEqual(projectListeners(mac, ['/rep']), [], '前缀相同的别的目录不算')

  // agent 在项目外起的服务：对话里写过它的网址就算这个会话的；只提到端口号、数据库连接串这类不算
  const said = mentionedPorts('服务起来了：http://127.0.0.1:8000/ 或 http://localhost:8000，数据库在 127.0.0.1:5432，另见 [::1]:22')
  assert.deepEqual([...said], [8000])
  assert.deepEqual(projectListeners(mac, ['/repo'], said).map((l) => l.port), [5173, 5173, 8000])
  assert.deepEqual(projectListeners(mac, ['/repo'], new Set([22])).map((l) => l.port), [5173, 5173], '系统端口提到了也不开')
})

test('本地服务：只列说 HTTP 的；不吭声的要是 node 这类运行时起的才算', async (t) => {
  const listen = (handler: (s: import('node:net').Socket) => void) =>
    new Promise<number>((ok) => {
      const server = createServer(handler).listen(0, '127.0.0.1', () => ok((server.address() as { port: number }).port))
      t.after(() => server.close())
    })
  const web = await listen((s) => s.once('data', () => s.end('HTTP/1.1 200 OK\r\n\r\n')))
  const banner = await listen((s) => s.write('Android Console: type help\r\n'))
  const quiet = await listen(() => {})
  const quietNode = await listen(() => {})
  const all: Listener[] = [
    { pid: 1, command: 'python3', host: '127.0.0.1', port: web, cwd: '/repo' },
    { pid: 2, command: 'qemu-system-aarch64', host: '127.0.0.1', port: banner, cwd: '/repo' },
    { pid: 3, command: 'adb', host: '127.0.0.1', port: quiet, cwd: '/repo' },
    { pid: 4, command: 'node', host: '127.0.0.1', port: quietNode, cwd: '/repo' },
  ]
  assert.deepEqual((await projectServices(all, ['/repo'])).map((s) => s.command).sort(), ['node', 'python3'])
})

test('本地服务：只在本机地址上的开转发（HTTP 和长连接都通），所有地址上都在听的直接给地址，闲置了关掉', async (t) => {
  t.after(closeForwards)
  // 开发服务器：只听 IPv6 本机地址，原样回显
  const dev = createServer((s) => s.pipe(s))
  await new Promise<void>((ok) => dev.listen(0, '::1', ok))
  t.after(() => dev.close())
  const port = (dev.address() as { port: number }).port
  const listening: Listener[] = [{ pid: 1, command: 'node', host: '::1', port, cwd: '/repo' }]

  // 测试里拿 127.0.0.1 当「Tailscale 地址」
  const { url } = await openService(port, listening, '127.0.0.1', 200)
  assert.equal(url, `http://127.0.0.1:${port}`)
  const echo = await new Promise<string>((ok, fail) => {
    const c = connect(port)
    c.on('data', (d) => (ok(String(d)), c.end())).on('error', fail)
    c.write('ping')
  })
  assert.equal(echo, 'ping')
  // 再要一次：同一个转发
  assert.equal((await openService(port, listening, '127.0.0.1', 200)).url, url)

  // 本来就在所有地址上听的：不开转发
  assert.equal((await openService(9999, [{ pid: 2, command: 'vite', host: '*', port: 9999 }], '127.0.0.1')).url, 'http://127.0.0.1:9999')
  await assert.rejects(openService(1234, listening, '127.0.0.1'), /Nothing in this project/)
  await assert.rejects(openService(port, listening, ''), /Tailscale/)

  // 闲置 200ms 后关掉：再连就连不上
  await new Promise((ok) => setTimeout(ok, 500))
  await assert.rejects(new Promise((ok, fail) => connect(port).on('connect', ok).on('error', fail)))
})

const connect = (port: number) => createConnection(port, '127.0.0.1')
