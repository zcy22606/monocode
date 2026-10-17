/**
 * Soloyard：把电脑上的会话推给家里主机的网关（soloyard/host/gateway.ts），手机上才看得到「电脑上的」会话。
 * 读上游的 sessions 表（只读，不改上游表），每隔几秒把变了的会话推过去：归档、隐藏、草稿、收件箱临时会话不推，
 * 推过的后来被归档或删掉了就让网关删掉。推到哪了记在 soloyard_mirror，网关地址和凭据在 soloyard_sync。
 *
 * 两种跑法：
 * - 桌面 Soloyard 的 sidecar 里（startMirror），设置页里配网关；
 * - 试用：单独跑，只读打开库，进度存 JSON（文件末尾的命令行）：
 *     node soloyard/core/src/mirror.ts --db <monocode.db> --gateway http://127.0.0.1:3775 --token-file <设备凭据 json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DB } from './db.ts'
import { readSharedFile } from './file-share.ts'
import { listeners, openService, projectListeners, projectServices } from './services.ts'
import { repoKey } from './repokey.ts'

export type MirrorConfig = { url: string; token: string; machine: string }
/** 会话 id → 推过的 updated_at */
export type Pushed = Map<string, number>

// ponytail: 只推最近两周动过的会话；更早的手机上用不着，要了再放宽
const RECENT = 14 * 86_400_000
const BATCH_BYTES = 8 << 20
export const machineName = () => hostname().replace(/\.local$/, '')

type Brief = { id: string; updated_at: number; archived: number | null; is_draft: number | null; sidebar_hidden: number | null; inbox_ask: string | null; has_user_message: number | null }
type Full = Brief & {
  cwd: string; harness: string; model: string; model_settings: string | null; runtime_mode: string; title: string
  provider_session_id: string | null; blocks_json: string; created_at: number; branch: string | null; worktree_cwd: string | null
}

const hasSessions = (db: DatabaseSync) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()
const shown = (r: Brief) => !r.archived && !r.is_draft && !r.sidebar_hidden && !r.inbox_ask && r.has_user_message !== 0
const json = <T,>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

function toPush(r: Full) {
  const session = {
    id: r.id, title: r.title, harness: r.harness, model: r.model, modelSettings: json(r.model_settings, {}), runtimeMode: r.runtime_mode,
    cwd: r.cwd, worktreeCwd: r.worktree_cwd ?? undefined, branch: r.branch ?? undefined, providerSessionId: r.provider_session_id ?? undefined,
    createdAt: r.created_at, blocks: json<unknown[]>(r.blocks_json, []),
  }
  return {
    // 会话的 cwd 是项目根目录（多仓库项目里成员仓库只是 worktreeCwd），按它认项目
    id: r.id, cwd: r.cwd, repoKey: repoKey(r.cwd), title: r.title, harness: r.harness, model: r.model,
    providerSessionId: r.provider_session_id, branch: r.branch, updatedAt: r.updated_at, session,
  }
}

/** 这一轮要推的会话、要网关删掉的 id。先只读轻量的列，变了的才读整段对话。 */
export function collect(db: DatabaseSync, pushed: Pushed, now = Date.now()) {
  if (!hasSessions(db)) return { sessions: [], removed: [] as string[] }
  const briefs = db
    .prepare('SELECT id, updated_at, archived, is_draft, sidebar_hidden, inbox_ask, has_user_message FROM sessions WHERE updated_at >= ?')
    .all(now - RECENT) as Brief[]
  const full = db.prepare('SELECT * FROM sessions WHERE id = ?')
  const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
  const sessions: ReturnType<typeof toPush>[] = []
  const removed: string[] = []
  const recent = new Set<string>()
  for (const b of briefs) {
    recent.add(b.id)
    if (!shown(b)) {
      if (pushed.has(b.id)) removed.push(b.id)
    } else if (pushed.get(b.id) !== b.updated_at) sessions.push(toPush(full.get(b.id) as Full))
  }
  // 推过、现在表里没有了（被删掉）
  for (const id of pushed.keys()) if (!recent.has(id) && !exists.get(id)) removed.push(id)
  return { sessions, removed }
}

async function rpc(config: MirrorConfig, method: string, params: object = {}, stop?: AbortSignal) {
  const timeout = AbortSignal.timeout(60_000)
  const response = await fetch(`${config.url.replace(/\/+$/, '')}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, method, params }),
    signal: stop ? AbortSignal.any([timeout, stop]) : timeout,
  })
  const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string }
  if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body.result
}

/** 推一轮：大的会话分批（每批不超过 8 MB）；推成功的记进 pushed。 */
export async function pushOnce(db: DatabaseSync, config: MirrorConfig, pushed: Pushed) {
  const { sessions, removed } = collect(db, pushed)
  if (!sessions.length && !removed.length) return { stored: 0, removed: 0 }
  let batch: typeof sessions = []
  let size = 0
  let stored = 0
  const flush = async (gone: string[]) => {
    const result = (await rpc(config, 'soloyard.mirror.push', { machine: config.machine, sessions: batch, removed: gone })) as { stored: number }
    stored += result.stored
    for (const s of batch) pushed.set(s.id, s.updatedAt)
    for (const id of gone) pushed.delete(id)
    batch = []
    size = 0
  }
  for (const s of sessions) {
    const n = JSON.stringify(s).length
    if (batch.length && size + n > BATCH_BYTES) await flush([])
    batch.push(s)
    size += n
  }
  await flush(removed)
  return { stored, removed: removed.length }
}

// ---------- 桌面 sidecar 里：配置和进度存库 ----------
const read = (db: DB, key: string) => (db.prepare('SELECT value FROM soloyard_sync WHERE key = ?').get(key) as { value: string } | undefined)?.value
const write = (db: DB, key: string, value: string) =>
  db.prepare('INSERT INTO soloyard_sync (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

export function syncConfig(db: DB): MirrorConfig | null {
  const url = read(db, 'gateway.url')
  const token = read(db, 'gateway.token')
  return url && token ? { url, token, machine: read(db, 'gateway.machine') || machineName() } : null
}

/** 配网关：先问一下网关是谁、这个凭据是不是「电脑」，对了才存。 */
export async function connectSync(db: DB, url: string, token: string) {
  const config = { url: url.trim().replace(/\/+$/, ''), token: token.trim(), machine: machineName() }
  const who = (await rpc(config, 'soloyard.describe')) as { name: string; device: { kind: string } }
  if (who.device.kind !== 'desktop') throw new Error('This credential is for a phone. Pair one with --desktop on the host.')
  write(db, 'gateway.url', config.url)
  write(db, 'gateway.token', config.token)
  write(db, 'gateway.machine', config.machine)
  write(db, 'gateway.host', who.name)
  db.exec('DELETE FROM soloyard_mirror')
  write(db, 'mirror.error', '')
  return { host: who.name }
}

export function disconnectSync(db: DB) {
  db.exec("DELETE FROM soloyard_sync WHERE key LIKE 'gateway.%' OR key LIKE 'mirror.%'")
  db.exec('DELETE FROM soloyard_mirror')
}

export function syncStatus(db: DB) {
  const config = syncConfig(db)
  const pushedAt = Number(read(db, 'mirror.pushedAt') ?? 0)
  return {
    connected: !!config,
    url: config?.url ?? null,
    host: read(db, 'gateway.host') ?? null,
    machine: config?.machine ?? machineName(),
    pushedAt: pushedAt || null,
    error: read(db, 'mirror.error') || null,
    sessions: Number((db.prepare('SELECT COUNT(*) AS n FROM soloyard_mirror').get() as { n: number }).n),
  }
}

// ---------- 反过来：主机上的会话（手机上开的 / 手机上接着聊的）拿回电脑上接着聊 ----------
/** 主机上和这个项目同一个仓库的会话；没配网关就是空的。 */
export async function hostSessions(db: DB, cwd: string) {
  const config = syncConfig(db)
  return config ? rpc(config, 'soloyard.host.list', { repoKey: repoKey(cwd) }) : []
}

/** 正在跑的这一轮（界面每秒给一次，见 src/features/soloyard/model/liveMirror.ts）；没配网关就丢掉。 */
export async function livePush(db: DB, id: string, live: { from?: string; blocks: unknown[]; busy: boolean }) {
  const config = syncConfig(db)
  return config ? rpc(config, 'soloyard.mirror.live', { id, ...live }) : null
}

/** 会话还在后台跑的任务（界面在列表变了、和每 30 秒推一次，见 liveMirror.ts）；没配网关就丢掉。 */
export async function jobsPush(db: DB, id: string, jobs: unknown[]) {
  const config = syncConfig(db)
  return config ? rpc(config, 'soloyard.mirror.jobs', { id, jobs }) : null
}

/** 手机发给这台电脑上会话的消息（来取一次也是告诉网关电脑开着）；没配网关就是空的。 */
export async function relayInbox(db: DB) {
  const config = syncConfig(db)
  return config ? ((await rpc(config, 'soloyard.relay.pull')) as { id: string; sessionId: string; text: string; stopJob?: string }[]) : []
}

/** 拿回来：主机上归档，返回整份会话（界面用它建本地会话，或者接回原来那个电脑会话）。 */
export async function takeHostSession(db: DB, sessionId: string) {
  const config = syncConfig(db)
  if (!config) throw new Error('Not connected to a host')
  return rpc(config, 'soloyard.host.take', { sessionId })
}

// ---------- 手机要这台电脑做的事：看会话里的文件（SOL-92）、列 / 打开本地服务（SOL-97）----------
// 长轮询网关，来了请求就做完交回去。
type FileAsk = {
  id: string; kind?: 'file' | 'services' | 'open' | 'data'; sessionId?: string; path?: string; mtime?: number; port?: number; preview?: boolean
  /** kind = data：手机要的 issue 数据（SOL-100），交给数据进程的白名单（phone.ts）。 */
  method?: string; args?: unknown[]
}
/** 数据进程里替手机调数据方法（只有 sidecar 里才有；单独跑的试用推送进程没有）。 */
export type PhoneCall = (method: string, args: unknown[]) => Promise<unknown>
type SessionRow = { cwd: string; worktree_cwd: string | null; blocks_json: string | null }

const sessionRow = (db: DatabaseSync, id = '') => {
  const row = db.prepare('SELECT cwd, worktree_cwd, blocks_json FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!row) throw new Error('Session not found')
  return row
}

/** 列 / 打开这个会话目录里的本地服务，结果经 RPC 交回去。 */
async function answerServices(db: DatabaseSync, config: MirrorConfig, ask: FileAsk) {
  try {
    const row = sessionRow(db, ask.sessionId)
    const roots = [row.cwd, row.worktree_cwd].filter((r): r is string => !!r)
    const all = await listeners()
    const result = ask.kind === 'open' ? await openService(Number(ask.port), projectListeners(all, roots)) : await projectServices(all, roots)
    await rpc(config, 'soloyard.relay.answer', { id: ask.id, result })
  } catch (e) {
    await rpc(config, 'soloyard.relay.answer', { id: ask.id, error: (e as Error).message })
  }
}

/** 手机要的数据：交给数据进程的白名单，结果经 RPC 交回去。 */
async function answerData(config: MirrorConfig, ask: FileAsk, call?: PhoneCall) {
  try {
    if (!call) throw new Error('This computer cannot answer data requests')
    await rpc(config, 'soloyard.relay.answer', { id: ask.id, result: (await call(String(ask.method), ask.args ?? [])) ?? null })
  } catch (e) {
    await rpc(config, 'soloyard.relay.answer', { id: ask.id, error: (e as Error).message })
  }
}

/** 读一个文件交给网关；读不了把原因交回去，手机上显示。 */
export async function answerFile(db: DatabaseSync, config: MirrorConfig, ask: FileAsk, call?: PhoneCall) {
  if (ask.kind === 'data') return answerData(config, ask, call)
  if (ask.kind === 'services' || ask.kind === 'open') return answerServices(db, config, ask)
  let headers: Record<string, string>
  let body: Buffer | undefined
  try {
    const row = sessionRow(db, ask.sessionId)
    // ponytail: 只认存盘的对话，正在跑的这一轮里新提到的项目外文件要等这一轮结束
    const { data, ...meta } = readSharedFile(ask.path ?? '', { cwd: row.cwd, worktreeCwd: row.worktree_cwd, blocksJson: row.blocks_json ?? '' }, ask.mtime, ask.preview === true)
    headers = { 'x-soloyard-file': encodeURIComponent(JSON.stringify(meta)), ...(data ? {} : { 'x-soloyard-unchanged': '1' }) }
    body = data
  } catch (e) {
    headers = { 'x-soloyard-error': encodeURIComponent((e as Error).message) }
  }
  await fetch(`${config.url.replace(/\/+$/, '')}/file/${ask.id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, ...headers },
    body,
    signal: AbortSignal.timeout(120_000),
  })
}

/** 一直等网关的取文件请求；没配网关或出错了隔 5 秒再试。返回停止函数。 */
export function serveFiles(db: DatabaseSync, config: () => MirrorConfig | null, log: (msg: string) => void, call?: PhoneCall) {
  const stop = new AbortController()
  const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
  void (async () => {
    while (!stop.signal.aborted) {
      try {
        const c = config()
        if (!c) {
          await sleep(5000)
          continue
        }
        // 告诉网关能不能答数据请求（只有桌面 Soloyard 的数据进程带着 call）
        const asks = (await rpc(c, 'soloyard.files.pull', { data: !!call }, stop.signal)) as FileAsk[]
        for (const ask of asks) void answerFile(db, c, ask, call).catch((e: Error) => log(`files: ${e.message}`))
      } catch (e) {
        if (stop.signal.aborted) return
        log(`files: ${(e as Error).message}`)
        await sleep(5000)
      }
    }
  })()
  return () => stop.abort()
}

/** 两张表也在 db.ts 的迁移里；这里再建一次，迁移号被别的分支占了的库（开发版跑过 SOL-68）也有。 */
export function ensureTables(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS soloyard_sync (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS soloyard_mirror (session_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL);`)
}

/** sidecar 里每 5 秒推一轮；没配网关就什么也不做。出错了往后退（最长一分钟），状态写进库给设置页看。 */
export function startMirror(db: DB, log: (msg: string) => void, call?: PhoneCall) {
  ensureTables(db)
  let busy = false
  let wait = 0
  let failures = 0
  const timer = setInterval(async () => {
    if (busy || wait-- > 0) return
    busy = true
    // 整轮都兜住：定时器里抛出去会让整个数据进程退出
    try {
      const config = syncConfig(db)
      if (!config) return
      const pushed: Pushed = new Map((db.prepare('SELECT session_id, updated_at FROM soloyard_mirror').all() as { session_id: string; updated_at: number }[]).map((r) => [r.session_id, r.updated_at]))
      const before = new Map(pushed)
      const result = await pushOnce(db, config, pushed)
      failures = 0
      if (result.stored || result.removed) {
        const put = db.prepare('INSERT INTO soloyard_mirror (session_id, updated_at) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at')
        for (const [id, at] of pushed) if (before.get(id) !== at) put.run(id, at)
        const del = db.prepare('DELETE FROM soloyard_mirror WHERE session_id = ?')
        for (const id of before.keys()) if (!pushed.has(id)) del.run(id)
        write(db, 'mirror.pushedAt', String(Date.now()))
      }
      write(db, 'mirror.error', '')
    } catch (e) {
      failures++
      wait = Math.min(12, 2 ** failures)
      try {
        write(db, 'mirror.error', (e as Error).message)
      } catch {
        // 库本身出问题时只记日志
      }
      log(`mirror: ${(e as Error).message}`)
    } finally {
      busy = false
    }
  }, 5000)
  const stopFiles = serveFiles(db, () => syncConfig(db), log, call)
  return () => {
    clearInterval(timer)
    stopFiles()
  }
}

// ---------- 试用：单独跑 ----------
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const dbPath = flag('db')
  const url = flag('gateway')
  const tokenFile = flag('token-file')
  if (!dbPath || !url || !tokenFile) {
    console.error('usage: mirror.ts --db <monocode.db> --gateway <网关地址> --token-file <设备凭据 json> [--state <进度 json>]')
    process.exit(2)
  }
  const statePath = flag('state') ?? `${tokenFile}.mirror-state.json`
  // 只读打开：试用时不碰桌面应用的库
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const config = { url, token: (JSON.parse(readFileSync(tokenFile, 'utf8')) as { token: string }).token, machine: machineName() }
  const pushed: Pushed = new Map(Object.entries(json<Record<string, number>>(readFileSync(statePath, { encoding: 'utf8', flag: 'a+' }), {})))
  const tick = async () => {
    try {
      const result = await pushOnce(db, config, pushed)
      if (result.stored || result.removed) {
        writeFileSync(statePath, JSON.stringify(Object.fromEntries(pushed)))
        console.log(`${new Date().toLocaleTimeString()} 推了 ${result.stored} 个会话，删了 ${result.removed} 个`)
      }
    } catch (e) {
      console.error(`${new Date().toLocaleTimeString()} ${(e as Error).message}`)
    }
  }
  await tick()
  setInterval(tick, 5000)
  serveFiles(db, () => config, (msg) => console.error(`${new Date().toLocaleTimeString()} ${msg}`))
}
