import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FileRelay, GatewayStore, markPhoneWaiting, startGateway, watchHost } from '../gateway.ts'

const HOST_TOKEN = 'h'.repeat(43)

/** 假的 monocode-host：只认网关的凭据，回显收到的方法；hostAuth=false 时模拟网关凭据被吊销。 */
async function fakeHost(state: { hostAuth: boolean; seen: string[] }) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (!state.hostAuth || req.headers.authorization !== `Bearer ${HOST_TOKEN}`) return res.writeHead(401).end(JSON.stringify({ error: 'Device credential is invalid or revoked' }))
      const input = JSON.parse(body)
      state.seen.push(input.method)
      res.end(JSON.stringify({ result: { method: input.method, environmentId: input.environmentId } }))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const a = server.address() as { port: number }
  return { server, url: `http://127.0.0.1:${a.port}` }
}

const call = (url: string, token: string | null, method: string, params: object = {}, headers: Record<string, string> = {}) =>
  fetch(`${url}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify({ version: 1, environmentId: 'env-1', method, params }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))

const session = (id: string, updatedAt: number, text: string) => ({
  id, cwd: '/Users/me/Workspace/openroboto', repoKey: 'github.com/me/openroboto', title: `会话 ${id}`, harness: 'claude', model: 'claude:opus',
  providerSessionId: `p-${id}`, branch: 'main', updatedAt, session: { id, title: `会话 ${id}`, blocks: [{ id: 'b1', role: 'user', text }] },
})

test('网关：鉴权、转发换凭据、两类设备的权限、会话镜像', async (t) => {
  const state = { hostAuth: true, seen: [] as string[] }
  const host = await fakeHost(state)
  const dataDir = mkdtempSync(join(tmpdir(), 'soloyard-gateway-'))
  writeFileSync(join(dataDir, 'host-device.json'), JSON.stringify({ token: HOST_TOKEN }))
  const { server, store, url } = await startGateway({ dataDir, listen: '127.0.0.1:0', hostUrl: host.url })
  t.after(() => {
    server.close()
    host.server.close()
  })
  const phone = store.pair('手机', 'phone')
  const desktop = store.pair('MacBook', 'desktop')

  // 鉴权
  assert.equal((await call(url, null, 'projects.list')).status, 401)
  assert.equal((await call(url, 'x'.repeat(43), 'projects.list')).status, 401)
  assert.equal((await call(url, phone.token, 'projects.list', {}, { origin: 'https://evil.example' })).status, 403, '浏览器来的一律拒')

  // 手机的请求原样转给主机，主机看到的是网关的凭据
  const listed = await call(url, phone.token, 'projects.list')
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.result, { method: 'projects.list', environmentId: 'env-1' })
  assert.deepEqual(state.seen, ['projects.list'])
  assert.equal((await call(url, desktop.token, 'projects.list')).status, 403, '电脑只能推会话，不能操作主机')

  // 电脑推镜像，手机读
  assert.equal((await call(url, phone.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('s1', 10, 'hi')] })).status, 400, '手机不能推')
  const pushed = await call(url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('s1', 10, 'hi'), session('s2', 20, 'yo')] })
  assert.deepEqual(pushed.body.result, { stored: 2 })
  const list = (await call(url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })).body.result
  assert.deepEqual(list.map((s: { id: string }) => s.id), ['s2', 's1'], '新的在前')
  assert.equal(list[0].machine, 'MacBook')
  const full = (await call(url, phone.token, 'soloyard.mirror.get', { id: 's1' })).body.result
  assert.equal(full.session.blocks[0].text, 'hi')
  assert.equal(full.providerSessionId, 'p-s1')
  assert.equal(full.totalBlocks, 1)
  assert.equal((await call(url, phone.token, 'soloyard.mirror.get', { id: 's2', tail: 1 })).body.result.session.blocks.length, 1, '只要最后几块')
  assert.deepEqual((await call(url, phone.token, 'soloyard.mirror.get', { id: 's1', revision: full.revision })).body.result, { unchanged: true, revision: 1, online: false, busy: false, jobs: [] })

  // 旧的覆盖不了新的；新的会让 revision 加一
  await call(url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('s1', 5, 'old')] })
  assert.equal((await call(url, phone.token, 'soloyard.mirror.get', { id: 's1' })).body.result.session.blocks[0].text, 'hi')
  await call(url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('s1', 30, 'new')] })
  const updated = (await call(url, phone.token, 'soloyard.mirror.get', { id: 's1', revision: 1 })).body.result
  assert.equal(updated.revision, 2)
  assert.equal(updated.session.blocks[0].text, 'new')

  // 只能删自己推过的
  const other = store.pair('另一台电脑', 'desktop')
  await call(url, other.token, 'soloyard.mirror.push', { machine: 'Other', sessions: [], removed: ['s1'] })
  assert.equal((await call(url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })).body.result.length, 2)
  await call(url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [], removed: ['s1'] })
  assert.deepEqual((await call(url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })).body.result.map((s: { id: string }) => s.id), ['s2'])

  // 网关自己的主机凭据失效：返回 502，手机不会以为自己被吊销
  state.hostAuth = false
  const broken = await call(url, phone.token, 'projects.list')
  assert.equal(broken.status, 502)
  assert.match(broken.body.error, /no longer paired/)

  // 吊销后就进不来
  store.revoke(phone.id)
  assert.equal((await call(url, phone.token, 'soloyard.describe')).status, 401)
})

test('在主机上接着聊电脑上的会话（SOL-89）', async (t) => {
  const dispatched: Record<string, unknown>[] = []
  type Hosted = { id: string; projectId: string; status: string; archived: boolean; updatedAt: number; session: Record<string, unknown> }
  const alive = new Map<string, Hosted>()
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { method, params, environmentId } = JSON.parse(body)
      const ok = (result: unknown) => res.end(JSON.stringify({ result }))
      const fail = (error: string) => res.writeHead(400).end(JSON.stringify({ error }))
      if (method === 'environment.describe') return ok({ environmentId: 'env-h' })
      if (environmentId !== 'env-h') return fail('Host identity changed; reconnect this machine explicitly')
      if (method === 'projects.list') return ok([{ id: 'proj-1', cwd: '/Users/me/Workspace/openroboto', name: 'openroboto' }])
      const hosted = alive.get(params.sessionId)
      if (method === 'sessions.get') return hosted ? ok(hosted) : fail('Session not found on this machine')
      if (method === 'sessions.update') return hosted && params.projectId === hosted.projectId ? ok(Object.assign(hosted, { archived: params.archived })) : fail('bad update')
      if (method === 'sessions.list')
        return ok([...alive.values()].map((h) => ({ id: h.id, projectId: h.projectId, status: h.status, archived: h.archived, updatedAt: h.updatedAt, harness: 'claude', ...h.session })))
      if (method === 'commands.dispatch') {
        if (params.worktreeCwd) return fail('Choose an available worktree of this project')
        dispatched.push(params)
        const sessionId = `host-${dispatched.length}`
        const { title, providerSessionId, blocks } = params.import
        alive.set(sessionId, { id: sessionId, projectId: params.projectId, status: 'idle', archived: false, updatedAt: dispatched.length, session: { title, providerSessionId, blocks } })
        return ok({ sessionId, commandId: params.commandId, revision: 1 })
      }
      fail(`unexpected ${method}`)
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const dataDir = mkdtempSync(join(tmpdir(), 'soloyard-gateway-'))
  writeFileSync(join(dataDir, 'host-device.json'), JSON.stringify({ token: HOST_TOKEN }))
  const gw = await startGateway({ dataDir, listen: '127.0.0.1:0', hostUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
  t.after(() => {
    gw.server.close()
    server.close()
  })
  const phone = gw.store.pair('手机', 'phone')
  const desktop = gw.store.pair('MacBook', 'desktop')
  const a = session('a', 100, '修登录')
  a.session = { ...a.session, worktreeCwd: '/Users/me/wt/a', runtimeMode: 'full-access', modelSettings: { effort: 'high' } } as typeof a.session
  const b = { ...session('b', 100, '没跑过'), providerSessionId: null }
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [a, b] })

  assert.equal((await call(gw.url, desktop.token, 'soloyard.mirror.continue', { id: 'a' })).status, 400, '电脑不能替手机接')
  assert.match((await call(gw.url, phone.token, 'soloyard.mirror.continue', { id: 'b' })).body.error, /no agent conversation/)

  const first = await call(gw.url, phone.token, 'soloyard.mirror.continue', { id: 'a' })
  assert.deepEqual(first.body.result, { sessionId: 'host-1', projectId: 'proj-1' })
  const sent = dispatched[0] as { import: { providerSessionId: string; title: string; blocks: unknown[] }; runtimeMode: string; modelSettings: object; harness: string }
  assert.equal(sent.import.providerSessionId, 'p-a')
  assert.equal(sent.import.title, '会话 a')
  assert.equal(sent.import.blocks.length, 1)
  assert.deepEqual([sent.harness, sent.runtimeMode, sent.modelSettings], ['claude', 'full-access', { effort: 'high' }])

  // 接过的再点回到同一个主机会话；列表和详情都告诉手机它已经在主机上接着聊了
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.continue', { id: 'a' })).body.result.sessionId, 'host-1')
  assert.equal(dispatched.length, 1)
  const listed = await call(gw.url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })
  assert.equal(listed.body.result.find((s: { id: string }) => s.id === 'a').continuedAs, 'host-1')
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'a' })).body.result.continuedAs, 'host-1')

  // 主机上那个会话被删了，再接就重新建
  alive.clear()
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.continue', { id: 'a' })).body.result.sessionId, 'host-2')

  // 电脑看主机上同一个仓库的会话，拿回去接着聊
  const key = { repoKey: 'dir:openroboto' } // 测试里主机项目的路径不存在，按文件夹名认
  assert.equal((await call(gw.url, phone.token, 'soloyard.host.list', key)).status, 400, '手机不能拿')
  alive.get('host-2')!.status = 'running'
  const onHost = (await call(gw.url, desktop.token, 'soloyard.host.list', key)).body.result
  assert.deepEqual(onHost.map((s: { id: string; continuedFrom?: string }) => [s.id, s.continuedFrom]), [['host-2', 'a']])
  assert.match((await call(gw.url, desktop.token, 'soloyard.host.take', { sessionId: 'host-2' })).body.error, /still running/)
  alive.get('host-2')!.status = 'idle'
  const taken = (await call(gw.url, desktop.token, 'soloyard.host.take', { sessionId: 'host-2' })).body.result
  assert.equal(taken.continuedFrom, 'a')
  assert.equal(taken.session.providerSessionId, 'p-a')
  assert.equal(alive.get('host-2')!.archived, true, '主机上归档，手机上不再接着发')
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.host.list', key)).body.result, [])
  // 拿回去了，手机上那份电脑会话又能重新在主机上接着聊
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'a' })).body.result.continuedAs, undefined)

  // 手机接过去以后：电脑推上来的新消息是手机发的（历史导入抄过来的）不算；电脑自己又发了一条 → 主机那份归档
  const c = session('c', 200, '开始')
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [c] })
  const hostC = (await call(gw.url, phone.token, 'soloyard.mirror.continue', { id: 'c' })).body.result.sessionId
  alive.get(hostC)!.session.blocks = [{ id: 'b1', role: 'user', text: '开始' }, { id: 'p1', role: 'user', text: '手机上发的' }]
  const later = Date.now() + 1000
  const pushC = (blocks: object[], updatedAt: number) =>
    call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [{ ...c, updatedAt, session: { ...c.session, blocks } }] })
  await pushC([{ id: 'b1', role: 'user', text: '开始' }, { id: 'x1', role: 'user', text: '手机上发的', startedAt: later }], 300)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(alive.get(hostC)!.archived, false, '历史导入抄过来的手机消息不算电脑接着聊')
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'c' })).body.result.continuedAs, hostC)
  await pushC([{ id: 'b1', role: 'user', text: '开始' }, { id: 'x2', role: 'user', text: '电脑上又问了一句', startedAt: later }], 400)
  for (let i = 0; i < 20 && !alive.get(hostC)!.archived; i++) await new Promise((r) => setTimeout(r, 20))
  assert.equal(alive.get(hostC)!.archived, true, '电脑自己接着聊了，主机那份归档')
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'c' })).body.result.continuedAs, undefined)

  // 电脑删了会话，接着聊的记录跟着清掉
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [], removed: ['a', 'b', 'c'] })
  assert.equal(gw.store.continued('a'), undefined)

  // 手机发给电脑会话：电脑开着（来取过消息）就交给电脑，不然手机改在主机上接着聊
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('r', 600, '电脑上的会话')] })
  const sendR = (commandId: string) => call(gw.url, phone.token, 'soloyard.mirror.send', { id: 'r', text: '手机上问一句', commandId })
  assert.deepEqual((await sendR('m1')).body.result, { relayed: false }, '电脑没来取过，算不在线')
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'r' })).body.result.online, false)
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [])
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'r' })).body.result.online, true)
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })).body.result.find((m: { id: string }) => m.id === 'r').online, true, '列表也标在线')
  assert.deepEqual((await sendR('m2')).body.result, { relayed: true })
  assert.deepEqual((await sendR('m2')).body.result, { relayed: true }, '同一个 commandId 重发不重复排')
  assert.equal((await call(gw.url, phone.token, 'soloyard.relay.pull')).status, 400, '手机不能取电脑的消息')
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [{ id: 'm2', sessionId: 'r', text: '手机上问一句' }])
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [], '取走就不再给')
  // 后台任务（SOL-99）：电脑推列表，手机打开会话一起拿到；手机点停止，转交给电脑，电脑来取时带着要停的任务
  const job = { id: 'j1', title: 'sleep 600', command: 'sleep 600', startedAt: 1 }
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.jobs', { id: 'r', jobs: [job] })).status, 400, '手机不能推')
  await call(gw.url, desktop.token, 'soloyard.mirror.jobs', { id: 'r', jobs: [job] })
  const withJobs = (await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'r' })).body.result
  assert.deepEqual(withJobs.jobs, [job])
  assert.deepEqual((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'r', revision: withJobs.revision })).body.result.jobs, [job], '没变也带上')
  assert.deepEqual((await call(gw.url, phone.token, 'soloyard.mirror.stopJob', { id: 'r', jobId: 'j1', commandId: 's1' })).body.result, { relayed: true })
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [{ id: 's1', sessionId: 'r', text: '', stopJob: 'j1' }])
  gw.store.db.prepare('UPDATE jobs SET at = ?').run(Date.now() - 70_000)
  assert.deepEqual((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'r' })).body.result.jobs, [], '一分钟没续，当作没了')
  await call(gw.url, desktop.token, 'soloyard.mirror.jobs', { id: 'r', jobs: [] })
  assert.equal(gw.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get()!.n, 0, '空了就删')

  gw.store.db.prepare('UPDATE presence SET seen_at = ?').run(Date.now() - 20_000)
  assert.deepEqual((await sendR('m3')).body.result, { relayed: false }, '电脑 15 秒没来取，算下线了')

  // 电脑正在跑的这一轮：每秒推一次盖在存盘的整份上面，手机看到实时的
  const L = session('L', 700, '第一轮')
  L.session.blocks.push({ id: 'a1', role: 'assistant', text: '答' } as never)
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [L] })
  const live = (blocks: object[], busy: boolean, token = desktop.token) =>
    call(gw.url, token, 'soloyard.mirror.live', { id: 'L', from: 'u2', blocks, busy })
  const before = (await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'L' })).body.result
  await live([{ id: 'u2', role: 'user', text: '第二轮' }, { id: 'a2', role: 'assistant', text: '写到一半', streaming: true }], true)
  const during = (await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'L', revision: before.revision })).body.result
  assert.deepEqual(during.session.blocks.map((b: { id: string }) => b.id), ['b1', 'a1', 'u2', 'a2'])
  assert.equal(during.busy, true)
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.list', { repoKey: 'github.com/me/openroboto' })).body.result.find((m: { id: string }) => m.id === 'L').busy, true)
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.live', { id: 'L', blocks: [], busy: true })).status, 400, '手机不能推')
  const other = gw.store.pair('另一台 Mac', 'desktop')
  assert.equal((await live([], true, other.token)).status, 400, '别的电脑不能盖这台的会话')
  // 一轮开头存了一次盘（整份推上来了），这一轮还在跑：盖着的不丢
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [{ ...L, updatedAt: 701, session: { ...L.session, blocks: [...L.session.blocks, { id: 'u2', role: 'user', text: '第二轮' }] } }] })
  assert.deepEqual((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'L' })).body.result.session.blocks.map((b: { id: string }) => b.id), ['b1', 'a1', 'u2', 'a2'])
  // 跑完了：最后推一次（不在跑），存盘的整份上来后盖着的去掉
  await live([{ id: 'u2', role: 'user', text: '第二轮', durationMs: 5000 }, { id: 'a2', role: 'assistant', text: '写完了' }], false)
  const after = (await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'L' })).body.result
  assert.equal(after.busy, false)
  assert.equal(after.session.blocks.at(-1).text, '写完了')
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [{ ...L, updatedAt: 702, session: { ...L.session, blocks: [...L.session.blocks, { id: 'u2', role: 'user', text: '第二轮' }, { id: 'a2', role: 'assistant', text: '写完了（存盘）' }] } }] })
  assert.equal((await call(gw.url, phone.token, 'soloyard.mirror.get', { id: 'L' })).body.result.session.blocks.at(-1).text, '写完了（存盘）')

  // 大的回复压缩（手机走海外中继时慢）
  await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('g', 500, '长'.repeat(5000))] })
  const big = await fetch(`${gw.url}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${phone.token}`, 'content-type': 'application/json', 'accept-encoding': 'gzip' },
    body: JSON.stringify({ version: 1, method: 'soloyard.mirror.get', params: { id: 'g' } }),
  })
  assert.equal(big.headers.get('content-encoding'), 'gzip')
  assert.equal(((await big.json()) as { result: { session: { blocks: { text: string }[] } } }).result.session.blocks[0].text.length, 5000)
})

test('手机看会话里的文件（SOL-92）：电脑上的会话交给那台电脑读，主机上的网关自己读', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const { serveFiles } = await import('../../core/src/mirror.ts')
  const { mkdirSync, realpathSync } = await import('node:fs')
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'soloyard-files-')))
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src/a.txt'), 'hello '.repeat(400))
  writeFileSync(join(repo, '.env'), 'TOKEN=x')
  writeFileSync(join(repo, 'empty.txt'), '')

  // 主机：sessions.get 给出主机上那个会话的目录
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { method } = JSON.parse(body)
      if (method === 'environment.describe') return res.end(JSON.stringify({ result: { environmentId: 'env-h' } }))
      res.end(JSON.stringify({ result: { projectId: 'p', session: { cwd: repo, blocks: [] } } }))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const dataDir = mkdtempSync(join(tmpdir(), 'soloyard-gateway-'))
  writeFileSync(join(dataDir, 'host-device.json'), JSON.stringify({ token: HOST_TOKEN }))
  const gw = await startGateway({ dataDir, listen: '127.0.0.1:0', hostUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
  const phone = gw.store.pair('手机', 'phone')
  const desktop = gw.store.pair('MacBook', 'desktop')
  const other = gw.store.pair('另一台', 'desktop')

  // 电脑的库：会话 s1 在 repo 里
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, worktree_cwd TEXT, blocks_json TEXT)')
  db.prepare('INSERT INTO sessions VALUES (?, ?, NULL, ?)').run('s1', repo, '[]')
  await call(gw.url, desktop.token, 'soloyard.mirror.push', {
    machine: 'MacBook',
    // 临时目录不是 git 仓库，仓库身份按文件夹名
    sessions: [{ ...session('s1', 100, 'hi'), cwd: repo, repoKey: `dir:${repo.split('/').pop()}`, session: { blocks: [{ id: 'w', role: 'tool', tool: { preview: { kind: 'write', path: 'src/a.txt' } } }] } }],
  })
  const fetchFile = (body: object, token = phone.token) =>
    fetch(`${gw.url}/file`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' }, body: JSON.stringify(body) })

  // 电脑还没来取过：马上说不在线，不干等
  assert.equal((await fetchFile({ id: 's1', path: 'src/a.txt' })).status, 409)

  // 数据进程替手机调数据方法（SOL-100）：这里假的，原样回显
  const stop = serveFiles(db, () => ({ url: gw.url, token: desktop.token, machine: 'MacBook' }), () => {}, async (method, args) => {
    if (method === 'boom') throw new Error('nope')
    return { method, args }
  })
  t.after(() => {
    stop()
    gw.server.close()
    server.close()
  })
  await new Promise((ok) => setTimeout(ok, 100))

  const got = await fetchFile({ id: 's1', path: 'src/a.txt' })
  assert.equal(got.status, 200)
  assert.equal(await got.text(), 'hello '.repeat(400))
  const meta = JSON.parse(decodeURIComponent(got.headers.get('x-soloyard-file')!))
  assert.equal(meta.name, 'a.txt')
  assert.equal(meta.size, 2400)
  assert.equal(got.headers.get('content-encoding'), 'gzip', '文本压过')
  // 手机缓存的没变：304，不带内容
  assert.equal((await fetchFile({ id: 's1', path: 'src/a.txt', mtime: meta.mtime })).status, 304)
  // 空文件照样给（不是「没变」）
  const empty = await fetchFile({ id: 's1', path: 'empty.txt' })
  assert.equal(empty.status, 200)
  assert.equal(await empty.text(), '')
  // 凭据不给，原因带回来
  const secret = await fetchFile({ id: 's1', path: '.env' })
  assert.equal(secret.status, 404)
  assert.match((await secret.json()).error, /Credential/)
  // 电脑不能来要文件，别的电脑不能替它交
  assert.equal((await fetchFile({ id: 's1', path: 'src/a.txt' }, desktop.token)).status, 403)
  const forged = await fetch(`${gw.url}/file/whatever`, { method: 'POST', headers: { authorization: `Bearer ${other.token}`, 'x-soloyard-error': 'x' } })
  assert.equal(forged.status, 404)

  // 会话的文件清单
  const listed = await call(gw.url, phone.token, 'soloyard.mirror.files', { id: 's1' })
  assert.deepEqual(listed.body.result, [{ path: `${repo}/src/a.txt`, kind: 'write', at: 0 }])

  // 手机要的 issue 数据：交给这个项目所在、开着的那台电脑
  const asked = await call(gw.url, phone.token, 'soloyard.data', { cwd: repo, method: 'projectIssues', args: [repo] })
  assert.deepEqual(asked.body.result, { method: 'projectIssues', args: [repo] })
  assert.equal((await call(gw.url, phone.token, 'soloyard.data', { cwd: repo, method: 'boom' })).body.error, 'nope')
  assert.equal((await call(gw.url, phone.token, 'soloyard.data', { cwd: '/nobody/has/this', method: 'projectIssues' })).body.error, 'The computer is offline')
  assert.equal((await call(gw.url, desktop.token, 'soloyard.data', { cwd: repo, method: 'projectIssues' })).status, 400, '只有手机能要')

  // 从 issue 开工：交给这个项目所在那台电脑的界面去开会话（界面开着 = 在取手机的消息）
  assert.equal((await call(gw.url, phone.token, 'soloyard.startWork', { cwd: repo, prompt: 'x', issueId: 1, commandId: 'w0' })).body.error, 'The computer is offline', '界面没开不交')
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [])
  const started = await call(gw.url, phone.token, 'soloyard.startWork', { cwd: repo, prompt: '开始处理 SOL-3', issueId: 3, workCwd: `${repo}/src`, commandId: 'w1' })
  assert.deepEqual(started.body.result, { relayed: true })
  assert.deepEqual((await call(gw.url, desktop.token, 'soloyard.relay.pull')).body.result, [
    { id: 'w1', sessionId: '', text: '', action: { kind: 'startWork', cwd: repo, prompt: '开始处理 SOL-3', issueId: 3, workCwd: `${repo}/src` } },
  ])
  assert.equal((await call(gw.url, phone.token, 'soloyard.startWork', { cwd: '/nobody/has/this', prompt: 'x', issueId: 1, commandId: 'w2' })).body.error, 'The computer is offline')

  // 主机上的会话：网关自己读
  const hosted = await fetchFile({ source: 'host', id: 'h1', path: 'src/a.txt' })
  assert.equal(hosted.status, 200)
  assert.equal((await hosted.text()).length, 2400)

  // 本地服务（SOL-97）：会话目录里起一个「开发服务器」，手机经网关问电脑列出来；项目外的端口打不开
  const { spawn } = await import('node:child_process')
  const dev = spawn(process.execPath, ['-e', "const s = require('net').createServer(c => c.once('data', () => c.end('HTTP/1.1 200 OK\\r\\n\\r\\n'))).listen(0, '127.0.0.1', () => console.log(s.address().port))"], { cwd: repo })
  t.after(() => dev.kill())
  const devPort = Number(await new Promise<string>((ok) => dev.stdout.once('data', (d) => ok(String(d).trim()))))
  const listed2 = await call(gw.url, phone.token, 'soloyard.services.list', { id: 's1' })
  assert.deepEqual(listed2.body.result, [{ port: devPort, command: 'node', pid: dev.pid }])
  const outside = await call(gw.url, phone.token, 'soloyard.services.open', { id: 's1', port: 1 })
  assert.match(outside.body.error, /Invalid port|Nothing in this project/)
  const notMine = await call(gw.url, phone.token, 'soloyard.services.open', { id: 's1', port: (gw.server.address() as { port: number }).port })
  assert.match(notMine.body.error, /Nothing in this project/)
  assert.equal((await call(gw.url, desktop.token, 'soloyard.services.list', { id: 's1' })).status, 400, '只有手机能要')
})

test('数据请求只交给能答的电脑（桌面 Soloyard 的数据进程），单独跑的推送进程不算', async () => {
  const relay = new FileRelay()
  void relay.pull('pusher', 1, false)
  void relay.pull('desktop', 1, true)
  await new Promise((ok) => setTimeout(ok, 10))
  assert.equal(relay.alive('pusher'), true, '取文件照样算开着')
  assert.equal(relay.alive('pusher', true), false)
  assert.equal(relay.alive('desktop', true), true)
})

test('手机通知（SOL-104）：电脑上的这一轮跑完了、开始等你处理；头一次连上不补以前的', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'soloyard-gateway-'))
  writeFileSync(join(dataDir, 'host-device.json'), JSON.stringify({ token: HOST_TOKEN }))
  const gw = await startGateway({ dataDir, listen: '127.0.0.1:0', hostUrl: 'http://127.0.0.1:9' })
  try {
    const phone = gw.store.pair('手机', 'phone')
    const desktop = gw.store.pair('MacBook', 'desktop')
    await call(gw.url, desktop.token, 'soloyard.mirror.push', { machine: 'MacBook', sessions: [session('n', 100, '修登录')] })
    const live = (busy: boolean, needsInput = false, blocks: object[] = []) =>
      call(gw.url, desktop.token, 'soloyard.mirror.live', { id: 'n', from: 'b1', blocks, busy, needsInput })
    const first = (await call(gw.url, phone.token, 'soloyard.events.wait', {})).body.result
    assert.deepEqual(first.events, [])
    await live(true)
    await live(true, true, [{ id: 't', role: 'tool', text: 'rm -rf build', tool: { title: 'rm -rf build' }, approval: { requestId: 1 } }])
    await live(true, true) // 还在等：不重复
    await live(true, false)
    await live(false, false, [{ id: 'a', role: 'assistant', text: '修好了，\n跑了测试。' }])
    await live(false) // 已经停了：不重复
    const got = (await call(gw.url, phone.token, 'soloyard.events.wait', { after: first.latest })).body.result
    assert.deepEqual(got.events.map((e: { kind: string; body: string; title: string; machine: string }) => [e.kind, e.title, e.body, e.machine]), [
      ['input', '会话 n', 'rm -rf build', 'MacBook'],
      ['done', '会话 n', '修好了， 跑了测试。', 'MacBook'],
    ])
    // 没有新的就等着，来了马上回
    const waiting = call(gw.url, phone.token, 'soloyard.events.wait', { after: got.latest, wait: 5000 })
    await new Promise((ok) => setTimeout(ok, 100))
    await live(true)
    await live(false)
    const woke = (await waiting).body.result
    assert.equal(woke.events.length, 1)
    assert.equal((await call(gw.url, desktop.token, 'soloyard.events.wait', {})).status, 400, '只有手机能等')
  } finally {
    gw.server.close()
  }
})

test('手机通知：主机上的会话从在跑变成停了、开始等你处理（只在有手机等着时去问主机）', async () => {
  const store = new GatewayStore(join(mkdtempSync(join(tmpdir(), 'soloyard-gateway-')), 'g.db'))
  let state = { status: 'running', needsInput: false }
  const host = async (method: string) => {
    if (method === 'projects.list') return [{ id: 'p1', cwd: '/repo' }]
    if (method === 'sessions.list') return [{ id: 'h1', projectId: 'p1', title: '修登录', harness: 'claude', updatedAt: 1, ...state }]
    if (method === 'sessions.get') return { session: { blocks: [{ role: 'assistant', text: '好了' }] } }
    throw new Error(method)
  }
  markPhoneWaiting()
  const stop = watchHost(store, host, 20)
  const settle = () => new Promise((ok) => setTimeout(ok, 80))
  try {
    await settle()
    state = { status: 'running', needsInput: true }
    await settle()
    state = { status: 'idle', needsInput: false }
    await settle()
    const { events } = await store.waitEvents(0, 0)
    assert.deepEqual(events.map((e) => [e.kind, e.source, e.sessionId, e.projectId, e.body]), [
      ['input', 'host', 'h1', 'p1', ''],
      ['done', 'host', 'h1', 'p1', '好了'],
    ])
  } finally {
    stop()
  }
})
