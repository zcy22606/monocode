/**
 * Soloyard 主机网关：手机唯一的入口（一个地址、一个凭据），跑在家里那台常驻主机上。
 * - `soloyard.*` 自己处理：设备身份、电脑推来的会话镜像。
 * - 其余原样转给 monocode-host（底座的主机服务，只对本机开放），转发时换成网关自己的主机凭据。
 *
 *   node soloyard/host/gateway.ts serve [--data-dir ~/.soloyard-host] [--listen 127.0.0.1:3775] [--host-url http://127.0.0.1:3774]
 *   node soloyard/host/gateway.ts pair --name 手机 [--desktop] [--json]
 *   node soloyard/host/gateway.ts devices
 *   node soloyard/host/gateway.ts revoke <设备 id>
 *
 * 网关自己的主机凭据放在 <data-dir>/host-device.json：`monocode-host pair --name soloyard-gateway --json` 的输出。
 * 对外只开网关（`tailscale serve --tcp 3775 tcp://127.0.0.1:3775`），monocode-host 不开。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { homedir, hostname } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { repoKey } from '../core/src/repokey.ts'
import { MAX_FILE, readSharedFile, type SharedFile } from '../core/src/file-share.ts'
import { sessionFiles } from '../core/src/session-files.ts'
import { listeners, mentionedPorts, openService, projectListeners, projectServices } from '../core/src/services.ts'

const PROTOCOL = 1
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/

export type Kind = 'phone' | 'desktop'
export type Device = { id: string; name: string; kind: Kind }

/** 电脑推上来的一个会话：显示用的摘要 + 整份会话（对话块等，原样存）。 */
export type MirrorPush = {
  id: string
  cwd: string
  repoKey: string
  title: string
  harness: string
  model: string
  providerSessionId?: string | null
  branch?: string | null
  updatedAt: number
  session: { blocks: unknown[] } & Record<string, unknown>
}

type Row = Record<string, string | number | null>

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
/** 电脑这么久没推正在跑的这一轮，就当它停了（崩了、睡了）。 */
const LIVE_STALE = 60_000
/** 电脑上的 Soloyard 每 2 秒来取一次消息，这么久没来就算不在线。 */
const ONLINE_WINDOW = 15_000

/** 存盘的整份 + 正在跑的这一轮：从 from 那块开始换成 live 的，live 里有的块不重复。 */
export function overlay<B extends { id?: string }>(blocks: B[], from: string | null, live: B[]) {
  const ids = new Set(live.map((b) => b.id))
  const cut = from ? blocks.findIndex((b) => b.id === from) : -1
  return [...(cut >= 0 ? blocks.slice(0, cut) : blocks).filter((b) => !ids.has(b.id)), ...live]
}
export type GatewayEvent = {
  kind: 'done' | 'input'; source: 'mirror' | 'host'; sessionId: string; title: string; body: string
  machine?: string; cwd?: string; projectId?: string
}
type LiveBlock = { role?: string; text?: string; approval?: { decided?: string }; tool?: { title?: string } }
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200)
/** 这一轮最后一句回答（通知正文）。 */
export const lastReply = (blocks: unknown) =>
  oneLine([...((blocks as LiveBlock[]) ?? [])].reverse().find((b) => b.role === 'assistant' && b.text?.trim())?.text ?? '')
/** 在等你批准的那一步（通知正文）；问问题的没有块，正文空着。 */
export const pendingAsk = (blocks: unknown) =>
  oneLine([...((blocks as LiveBlock[]) ?? [])].reverse().find((b) => b.approval && !b.approval.decided)?.tool?.title ?? '')

const text = (v: unknown, name: string, max = 4096) => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid ${name}`)
  return v
}

export class GatewayStore {
  readonly db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mirror_sessions (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL, machine TEXT NOT NULL, repo_key TEXT NOT NULL, cwd TEXT NOT NULL,
        title TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, provider_session_id TEXT, branch TEXT,
        updated_at INTEGER NOT NULL, pushed_at INTEGER NOT NULL, revision INTEGER NOT NULL, session_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mirror_repo ON mirror_sessions(repo_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS continued (
        mirror_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      DELETE FROM continued WHERE mirror_id NOT IN (SELECT id FROM mirror_sessions);
      CREATE TABLE IF NOT EXISTS presence (device_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS relay (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL, mirror_id TEXT NOT NULL, text TEXT NOT NULL,
        created_at INTEGER NOT NULL, taken_at INTEGER);
      CREATE TABLE IF NOT EXISTS live (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL, from_id TEXT, blocks_json TEXT NOT NULL, busy INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, jobs_json TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT NOT NULL, title TEXT NOT NULL,
        body TEXT NOT NULL, machine TEXT, cwd TEXT, project_id TEXT, at INTEGER NOT NULL);`)
    // 转交给电脑的除了消息，还有「停掉某个后台任务」（SOL-99）；老库补上这一列
    for (const [table, column] of [['relay', 'job_id TEXT'], ['relay', 'action_json TEXT'], ['live', 'needs_input INTEGER NOT NULL DEFAULT 0']]) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`)
      } catch {
        // 已经有了
      }
    }
  }

  /** 新设备凭据：43 位随机串，只给这一次，库里只存哈希。 */
  pair(name: string, kind: Kind) {
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO devices (id, name, kind, hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, kind, sha(token), Date.now())
    return { id, name, kind, token }
  }
  device(token: string): Device | undefined {
    return this.db.prepare('SELECT id, name, kind FROM devices WHERE hash = ?').get(sha(token)) as Device | undefined
  }
  devices() {
    return this.db.prepare('SELECT id, name, kind, created_at AS createdAt FROM devices ORDER BY created_at').all()
  }
  revoke(id: string) {
    return this.db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0
  }

  /** 收电脑推来的会话：比库里旧的不收（一样新的收）；removed 只能删这台电脑自己推过的。 */
  push(device: Device, params: Record<string, unknown>) {
    const machine = text(params.machine, 'machine', 200)
    const sessions = Array.isArray(params.sessions) ? params.sessions : []
    const removed = Array.isArray(params.removed) ? params.removed : []
    const now = Date.now()
    let stored = 0
    // 手机接过去以后电脑上又有了新的一轮：交给 releaseContinued 判断是不是电脑自己接着聊了
    const touched: { id: string; sessionId: string; turns: { text: string }[] }[] = []
    const get = this.db.prepare('SELECT updated_at, revision FROM mirror_sessions WHERE id = ?')
    const put = this.db.prepare(`INSERT INTO mirror_sessions (id, device_id, machine, repo_key, cwd, title, harness, model,
        provider_session_id, branch, updated_at, pushed_at, revision, session_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, machine = excluded.machine, repo_key = excluded.repo_key,
        cwd = excluded.cwd, title = excluded.title, harness = excluded.harness, model = excluded.model,
        provider_session_id = excluded.provider_session_id, branch = excluded.branch, updated_at = excluded.updated_at,
        pushed_at = excluded.pushed_at, revision = excluded.revision, session_json = excluded.session_json`)
    this.db.exec('BEGIN')
    try {
      for (const raw of sessions as MirrorPush[]) {
        const id = text(raw?.id, 'session id', 200)
        if (!Number.isFinite(raw.updatedAt) || !raw.session || !Array.isArray(raw.session.blocks)) throw new Error(`Invalid session ${id}`)
        const old = get.get(id) as { updated_at: number; revision: number } | undefined
        // 一样新的照收：电脑丢了进度重推时，顺便纠正项目归属等元数据
        if (old && old.updated_at > raw.updatedAt) continue
        put.run(
          id, device.id, machine, text(raw.repoKey, 'repoKey', 1000), text(raw.cwd, 'cwd'), text(raw.title ?? '', 'title', 1000),
          text(raw.harness, 'harness', 100), text(raw.model ?? '', 'model', 300), raw.providerSessionId ?? null, raw.branch ?? null,
          raw.updatedAt, now, (old?.revision ?? 0) + 1, JSON.stringify(raw.session),
        )
        stored++
        // 正在跑的这一轮由 live 接着盖在上面；跑完了，存盘的整份就是最新的
        this.db.prepare('DELETE FROM live WHERE id = ? AND (busy = 0 OR at < ?)').run(id, now - LIVE_STALE)
        const done = this.db.prepare('SELECT session_id, created_at FROM continued WHERE mirror_id = ?').get(id) as
          | { session_id: string; created_at: number }
          | undefined
        const turns = done
          ? (raw.session.blocks as { role?: string; text?: string; startedAt?: number }[]).filter(
              (b) => b.role === 'user' && (b.startedAt ?? 0) > done.created_at,
            )
          : []
        if (done && turns.length) touched.push({ id, sessionId: done.session_id, turns: turns.map((b) => ({ text: b.text ?? '' })) })
      }
      const del = this.db.prepare('DELETE FROM mirror_sessions WHERE id = ? AND device_id = ?')
      const forget = this.db.prepare('DELETE FROM continued WHERE mirror_id = ? AND NOT EXISTS (SELECT 1 FROM mirror_sessions WHERE id = ?)')
      for (const id of removed) if (typeof id === 'string') {
        del.run(id, device.id)
        forget.run(id, id)
        this.db.prepare('DELETE FROM live WHERE id = ? AND device_id = ?').run(id, device.id)
        this.db.prepare('DELETE FROM jobs WHERE id = ? AND device_id = ?').run(id, device.id)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { stored, touched }
  }

  /**
   * 电脑上自己接着聊了（推上来的新一轮用户消息不是手机发的）：会话回到电脑，主机上那份归档，手机上就不能再往里发了。
   * 同一台机器上电脑的历史导入会把手机上聊的抄进电脑会话，这些消息主机上也有，按内容认出来、不算。
   */
  async releaseContinued(touched: { id: string; sessionId: string; turns: { text: string }[] }[], host: HostCall) {
    for (const t of touched) {
      const value = (await host('sessions.get', { sessionId: t.sessionId }).catch((e: Error) => {
        if (/not found/i.test(e.message)) return null
        throw e
      })) as { projectId: string; archived?: boolean; session: { blocks: { role: string; text: string }[] } } | null
      const fromPhone = new Set(value?.session.blocks.filter((b) => b.role === 'user').map((b) => b.text) ?? [])
      if (value && t.turns.every((turn) => fromPhone.has(turn.text))) continue
      if (value && !value.archived) await host('sessions.update', { sessionId: t.sessionId, projectId: value.projectId, archived: true })
      this.db.prepare('DELETE FROM continued WHERE mirror_id = ? AND session_id = ?').run(t.id, t.sessionId)
    }
  }

  list(key: string) {
    const now = Date.now()
    return (this.db.prepare(`SELECT m.id, machine, cwd, title, harness, model, branch, updated_at, pushed_at, revision, c.session_id,
        (l.busy = 1 AND l.at > ?) AS busy, (p.seen_at > ?) AS online
      FROM mirror_sessions m LEFT JOIN continued c ON c.mirror_id = m.id LEFT JOIN live l ON l.id = m.id
        LEFT JOIN presence p ON p.device_id = m.device_id
      WHERE repo_key = ? ORDER BY updated_at DESC LIMIT 200`).all(now - LIVE_STALE, now - ONLINE_WINDOW, key) as Row[]).map((r) => ({
      id: r.id, machine: r.machine, cwd: r.cwd, title: r.title, harness: r.harness, model: r.model, branch: r.branch,
      updatedAt: r.updated_at, pushedAt: r.pushed_at, revision: r.revision, continuedAs: r.session_id ?? undefined,
      busy: !!r.busy, online: !!r.online,
    }))
  }

  /**
   * 整份会话；手机带着上次的 revision 来，没变就只回 unchanged。
   * tail = 只要最后几块（长会话有几千块，手机先拿最后一段，往上翻再多要）；totalBlocks 是总数。
   */
  get(id: string, revision?: unknown, tail?: unknown) {
    const r = this.db.prepare('SELECT * FROM mirror_sessions WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error('Session not found')
    const continuedAs = this.continued(id)?.sessionId
    const online = this.online(String(r.device_id))
    const l = this.db.prepare('SELECT from_id, blocks_json, busy, at FROM live WHERE id = ?').get(id) as
      | { from_id: string | null; blocks_json: string; busy: number; at: number }
      | undefined
    const busy = !!l?.busy && Date.now() - l.at < LIVE_STALE
    const jobs = this.liveJobs(id)
    if (revision === r.revision) return { unchanged: true, revision: r.revision, continuedAs, online, busy, jobs }
    const session = JSON.parse(String(r.session_json)) as { blocks: { id?: string }[] }
    if (l) session.blocks = overlay(session.blocks, l.from_id, JSON.parse(l.blocks_json))
    const totalBlocks = session.blocks.length
    if (typeof tail === 'number' && tail > 0) session.blocks = session.blocks.slice(-tail)
    return {
      id: r.id, machine: r.machine, cwd: r.cwd, harness: r.harness, model: r.model, providerSessionId: r.provider_session_id,
      branch: r.branch, updatedAt: r.updated_at, pushedAt: r.pushed_at, revision: r.revision, totalBlocks, session, continuedAs, online, busy, jobs,
    }
  }

  /**
   * 电脑正在跑的这一轮（电脑只在一轮开始和结束时存盘，中间过程每秒推一次）：盖在存盘的整份上面，手机看到的就是实时的。
   * from = 这一轮第一块（用户消息）的 id，从它开始换成 live 里的。
   */
  live(device: Device, params: Record<string, unknown>) {
    const id = text(params.id, 'session id', 200)
    if (!Array.isArray(params.blocks) || params.blocks.length > 400) throw new Error('Invalid blocks')
    const owner = (this.db.prepare('SELECT device_id FROM mirror_sessions WHERE id = ?').get(id) as { device_id: string } | undefined)?.device_id
    if (owner && owner !== device.id) throw new Error('This session belongs to another computer')
    const now = Date.now()
    const before = this.db.prepare('SELECT busy, needs_input FROM live WHERE id = ?').get(id) as { busy: number; needs_input: number } | undefined
    this.db.prepare(`INSERT INTO live (id, device_id, from_id, blocks_json, busy, needs_input, at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET from_id = excluded.from_id, blocks_json = excluded.blocks_json, busy = excluded.busy,
        needs_input = excluded.needs_input, at = excluded.at`)
      .run(id, device.id, params.from == null ? null : text(params.from, 'from', 200), JSON.stringify(params.blocks), params.busy ? 1 : 0, params.needsInput ? 1 : 0, now)
    // 手机通知（SOL-104）：这一轮跑完了、开始等你处理
    const session = this.db.prepare('SELECT title, machine, cwd FROM mirror_sessions WHERE id = ?').get(id) as Row | undefined
    if (session) {
      const base = { source: 'mirror' as const, sessionId: id, title: String(session.title), machine: String(session.machine), cwd: String(session.cwd) }
      if (before?.busy && !params.busy) this.addEvent({ ...base, kind: 'done', body: lastReply(params.blocks) })
      else if (!before?.needs_input && params.needsInput) this.addEvent({ ...base, kind: 'input', body: pendingAsk(params.blocks) })
    }
    // 手机按 revision 判断有没有变化
    this.db.prepare('UPDATE mirror_sessions SET revision = revision + 1 WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM live WHERE at < ?').run(now - 86_400_000)
    return { ok: true }
  }

  // ---------- 手机通知（SOL-104）：会话跑完了、等你处理；手机常驻的服务长连着来取 ----------
  private wakeEvents = new Set<() => void>()

  addEvent(e: GatewayEvent) {
    const now = Date.now()
    this.db.prepare('INSERT INTO events (kind, source, session_id, title, body, machine, cwd, project_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.kind, e.source, e.sessionId, e.title.slice(0, 300), e.body.slice(0, 300), e.machine ?? null, e.cwd ?? null, e.projectId ?? null, now)
    // ponytail: 只留一天，手机离线一天以上的就不补了
    this.db.prepare('DELETE FROM events WHERE at < ?').run(now - 86_400_000)
    for (const wake of this.wakeEvents) wake()
  }

  /** after 之后的事件；没有就等（最多 wait 毫秒）。after 不给 = 头一次连上：只告诉最新的 id，不补以前的。 */
  async waitEvents(after: unknown, wait = 25_000) {
    const latest = () => Number((this.db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM events').get() as { n: number }).n)
    if (typeof after !== 'number') return { events: [], latest: latest() }
    const read = () =>
      (this.db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT 20').all(after) as Row[]).map((r) => ({
        id: r.id, kind: r.kind, source: r.source, sessionId: r.session_id, title: r.title, body: r.body,
        machine: r.machine ?? undefined, cwd: r.cwd ?? undefined, projectId: r.project_id ?? undefined, at: r.at,
      }))
    let events = read()
    if (!events.length) {
      await new Promise<void>((ok) => {
        const done = () => {
          clearTimeout(timer)
          this.wakeEvents.delete(done)
          ok()
        }
        const timer = setTimeout(done, wait).unref()
        this.wakeEvents.add(done)
      })
      events = read()
    }
    return { events, latest: Math.max(latest(), after) }
  }

  // ---------- 手机发给电脑会话的消息：电脑开着就交给电脑跑（它自己的会话、自己的「进行中」） ----------
  /** 电脑上的 Soloyard 每 2 秒来取一次消息，顺便算它在线；超过 15 秒没来就当不在线。 */
  online(deviceId: string) {
    const seen = (this.db.prepare('SELECT seen_at FROM presence WHERE device_id = ?').get(deviceId) as { seen_at: number } | undefined)?.seen_at
    return !!seen && Date.now() - seen < ONLINE_WINDOW
  }

  /**
   * 电脑在线就排进它的收件箱，返回 relayed；不在线返回 false。commandId 重发不重复排。
   * jobId = 不是消息，是停掉这个会话的某个后台任务。
   */
  relay(mirrorId: string, text: string, commandId: string, jobId?: string) {
    const r = this.db.prepare('SELECT device_id FROM mirror_sessions WHERE id = ?').get(mirrorId) as { device_id: string } | undefined
    if (!r) throw new Error('Session not found')
    if (!this.online(r.device_id)) return { relayed: false }
    this.db.prepare('INSERT OR IGNORE INTO relay (id, device_id, mirror_id, text, created_at, job_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(commandId, r.device_id, mirrorId, text, Date.now(), jobId ?? null)
    return { relayed: true }
  }

  /** 交给电脑界面做的事（不是发进某个会话的消息）：比如从 issue 开工（SOL-100）。commandId 重发不重复排。 */
  relayAction(deviceId: string, action: Record<string, unknown>, commandId: string) {
    this.db.prepare('INSERT OR IGNORE INTO relay (id, device_id, mirror_id, text, created_at, action_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(commandId, deviceId, '', '', Date.now(), JSON.stringify(action))
    return { relayed: true }
  }

  /** 电脑上这个会话还在后台跑的任务（任何一轮起的）；列表变了或者每 30 秒推一次，空了就删。 */
  jobs(device: Device, id: string, jobs: unknown) {
    if (!Array.isArray(jobs) || jobs.length > 50) throw new Error('Invalid jobs')
    const owner = (this.db.prepare('SELECT device_id FROM mirror_sessions WHERE id = ?').get(id) as { device_id: string } | undefined)?.device_id
    if (owner && owner !== device.id) throw new Error('This session belongs to another computer')
    if (!jobs.length) this.db.prepare('DELETE FROM jobs WHERE id = ? AND device_id = ?').run(id, device.id)
    else
      this.db.prepare(`INSERT INTO jobs (id, device_id, jobs_json, at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET jobs_json = excluded.jobs_json, at = excluded.at`).run(id, device.id, JSON.stringify(jobs), Date.now())
    return { ok: true }
  }

  /** 一分钟没续上的当作没了（电脑关了、睡了）。 */
  liveJobs(id: string) {
    const row = this.db.prepare('SELECT jobs_json, at FROM jobs WHERE id = ?').get(id) as { jobs_json: string; at: number } | undefined
    return row && Date.now() - row.at < LIVE_STALE ? (JSON.parse(row.jobs_json) as unknown[]) : []
  }

  /** 电脑来取：记下在线，交出还没取过的消息（取走就算送到；电脑那边没发出去，手机上那条会超时提示重发）。 */
  pull(device: Device) {
    const now = Date.now()
    this.db.prepare('INSERT INTO presence (device_id, seen_at) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET seen_at = excluded.seen_at')
      .run(device.id, now)
    const rows = this.db.prepare('SELECT id, mirror_id, text, job_id, action_json FROM relay WHERE device_id = ? AND taken_at IS NULL ORDER BY created_at')
      .all(device.id) as { id: string; mirror_id: string; text: string; job_id: string | null; action_json: string | null }[]
    if (rows.length) this.db.prepare('UPDATE relay SET taken_at = ? WHERE device_id = ? AND taken_at IS NULL').run(now, device.id)
    // ponytail: 送达的旧消息只留一天，排查用
    this.db.prepare('DELETE FROM relay WHERE taken_at < ?').run(now - 86_400_000)
    return rows.map((m) => ({
      id: m.id, sessionId: m.mirror_id, text: m.text,
      ...(m.job_id ? { stopJob: m.job_id } : {}),
      ...(m.action_json ? { action: JSON.parse(m.action_json) } : {}),
    }))
  }

  continued(mirrorId: string) {
    return this.db.prepare('SELECT session_id AS sessionId, project_id AS projectId FROM continued WHERE mirror_id = ?').get(mirrorId) as
      | { sessionId: string; projectId: string }
      | undefined
  }

  /**
   * 在主机上接着聊电脑上的会话：找到（或打开）同一个仓库的主机项目，带着对话记录和 provider 会话 id 建一个主机会话，
   * 第一次发消息时 Claude Code / Codex 续上原来的对话。接过一次就记下来，再点直接回到那个主机会话。
   * ponytail: provider 的对话记录要在主机上（同一台 Mac 天然共享）；换成 mini 主机后要先把转录文件和代码同步过去。
   */
  async continueOnHost(id: string, host: HostCall) {
    const done = this.continued(id)
    if (done) {
      // 只有主机说会话没了才重建；主机连不上就报错，别多建一个
      const gone = await host('sessions.get', { sessionId: done.sessionId }).then(
        () => false,
        (e: Error) => (/not found/i.test(e.message) ? true : Promise.reject(e)),
      )
      if (!gone) return done
      this.db.prepare('DELETE FROM continued WHERE mirror_id = ?').run(id)
    }
    const r = this.db.prepare('SELECT * FROM mirror_sessions WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error('Session not found')
    const session = JSON.parse(String(r.session_json)) as {
      blocks: unknown[]; worktreeCwd?: string; modelSettings?: Record<string, string>; runtimeMode?: string
    }
    if (!r.provider_session_id) throw new Error('This session has no agent conversation to continue yet')
    const cwd = String(r.cwd)
    const projects = (await host('projects.list', {})) as { id: string; cwd: string }[]
    const project =
      projects.find((p) => p.cwd === cwd) ??
      projects.find((p) => repoKey(p.cwd) === r.repo_key) ??
      (existsSync(cwd) ? ((await host('projects.open', { cwd })) as { id: string }) : undefined)
    if (!project) throw new Error('No project on the host matches this session. Open the repository on the host first.')
    // 主机一次最多收 16 MB：只带最后一段对话（provider 那边有完整上下文），太大就再砍
    // 和手机上「在电脑上」页一次显示的一样多，换过去时界面不跳
    let blocks = session.blocks.slice(-120)
    while (blocks.length > 20 && JSON.stringify(blocks).length > 8 << 20) blocks = blocks.slice(Math.ceil(blocks.length / 4))
    const create = (worktreeCwd?: string) =>
      host('commands.dispatch', {
        type: 'create',
        commandId: randomUUID(),
        projectId: project.id,
        ...(worktreeCwd ? { worktreeCwd } : {}),
        harness: r.harness,
        model: r.model,
        modelSettings: session.modelSettings ?? {},
        runtimeMode: session.runtimeMode ?? 'supervised',
        import: { providerSessionId: r.provider_session_id, title: r.title || 'Untitled', blocks },
      }) as Promise<{ sessionId: string }>
    // 电脑上在工作树里干的，主机上也进同一个工作树；主机上没有这个工作树就在项目根目录接着干
    const created = session.worktreeCwd
      ? await create(session.worktreeCwd).catch(() => create())
      : await create()
    this.db.prepare('INSERT OR REPLACE INTO continued (mirror_id, session_id, project_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, created.sessionId, project.id, Date.now())
    return { sessionId: created.sessionId, projectId: project.id }
  }
}

type HostCall = (method: string, params: Record<string, unknown>) => Promise<unknown>
type HostSummary = {
  id: string; projectId: string; title: string; harness: string; model?: string; status: string; updatedAt: number
  archived?: boolean; draft?: boolean; needsInput?: boolean; providerSessionId?: string | null
}

/** 主机上这个仓库的会话（手机上开的，或者手机上接着聊的电脑会话）：电脑列出来，点了拿回去接着聊。 */
export async function hostSessions(store: GatewayStore, key: string, host: HostCall) {
  const projects = (await host('projects.list', {})) as { id: string; cwd: string }[]
  const lists = await Promise.all(
    projects.filter((p) => repoKey(p.cwd) === key).map((p) => host('sessions.list', { projectId: p.id }) as Promise<HostSummary[]>),
  )
  const from = store.db.prepare('SELECT mirror_id FROM continued WHERE session_id = ?')
  return lists
    .flat()
    // 还没跑过一轮的（没有 provider 会话）拿回去也续不上
    .filter((s) => !s.archived && !s.draft && s.providerSessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)
    .map((s) => ({
      id: s.id, projectId: s.projectId, title: s.title, harness: s.harness, model: s.model ?? '', status: s.status,
      needsInput: !!s.needsInput, updatedAt: s.updatedAt,
      continuedFrom: (from.get(s.id) as { mirror_id: string } | undefined)?.mirror_id,
    }))
}

/**
 * 电脑把主机上的会话拿回去接着聊：在主机上归档（手机上就不再能接着发，免得两边往一个对话里写），
 * 把整份会话交给电脑。正在跑的不给。原来是电脑会话在手机上接着聊的，带上 continuedFrom，电脑接回原会话。
 * ponytail: 读状态和归档之间手机又发了一条的话会漏判；一个人两台设备同时操作很少见，碰到再在主机上加锁。
 */
export async function takeFromHost(store: GatewayStore, sessionId: string, host: HostCall) {
  const value = (await host('sessions.get', { sessionId })) as {
    projectId: string; status: string; session: { busy?: boolean; providerSessionId?: string } & Record<string, unknown>
  }
  if (value.status === 'running' || value.session.busy) throw new Error('This session is still running on the host. Take it back when the turn finishes.')
  if (!value.session.providerSessionId) throw new Error('This session has no agent conversation to continue yet')
  await host('sessions.update', { sessionId, projectId: value.projectId, archived: true })
  const from = store.db.prepare('SELECT mirror_id FROM continued WHERE session_id = ?').get(sessionId) as { mirror_id: string } | undefined
  store.db.prepare('DELETE FROM continued WHERE session_id = ?').run(sessionId)
  return { session: value.session, continuedFrom: from?.mirror_id }
}

// ---------- 手机要电脑做的事：看会话里的文件（SOL-92）、列 / 打开本地服务（SOL-97）----------
// 电脑上的会话交给那台电脑做，主机上的网关自己做。
/** kind：file 取文件（path、mtime），services 列本地服务，open 打开一个端口（port）。 */
export type FileAsk = {
  id: string; kind: 'file' | 'services' | 'open' | 'data'; sessionId?: string; path?: string; mtime?: number; port?: number; preview?: boolean
  method?: string; args?: unknown[]
}
/** 交回来的：文件（有 data 是内容，没有是「没变」）、JSON 结果、或者做不了的原因。 */
export type FileAnswer = { error: string } | { result: unknown } | (Omit<SharedFile, 'data'> & { data?: Buffer })

/** 电脑长轮询来取请求（来了马上交出去），做完了交回来；都在内存里，网关重启了手机重试就行。 */
export class FileRelay {
  private queues = new Map<string, FileAsk[]>()
  private wake = new Map<string, () => void>()
  private waiting = new Map<string, { device: string; done: (answer: FileAnswer) => void }>()
  private seen = new Map<string, number>()
  /** 来取时说了自己能替手机读写 issue 数据的（桌面 Soloyard 的数据进程；单独跑的试用推送进程不能）。 */
  private dataCapable = new Set<string>()

  /** 这台电脑最近来取过（数据进程开着），不然手机马上提示，不用干等。data = 还要能答数据请求。 */
  alive(device: string, data = false) {
    return Date.now() - (this.seen.get(device) ?? 0) < 40_000 && (!data || this.dataCapable.has(device))
  }

  ask(device: string, ask: Omit<FileAsk, 'id'>, timeout = 30_000) {
    const id = randomUUID()
    return new Promise<FileAnswer>((done) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        const queue = this.queues.get(device)
        if (queue) this.queues.set(device, queue.filter((a) => a.id !== id))
        done({ error: 'The computer did not answer in time' })
      }, timeout)
      this.waiting.set(id, { device, done: (answer) => (clearTimeout(timer), this.waiting.delete(id), done(answer)) })
      this.queues.set(device, [...(this.queues.get(device) ?? []), { id, ...ask }])
      this.wake.get(device)?.()
    })
  }

  /** 有请求马上回，没有就等着（最多 wait 毫秒）。 */
  async pull(device: string, wait = 20_000, data = false) {
    this.seen.set(device, Date.now())
    if (data) this.dataCapable.add(device)
    else this.dataCapable.delete(device)
    if (!this.queues.get(device)?.length) {
      this.wake.get(device)?.()
      await new Promise<void>((ok) => {
        const go = () => {
          clearTimeout(timer)
          if (this.wake.get(device) === go) this.wake.delete(device)
          ok()
        }
        // 不让等着的长轮询拖住进程退出
        const timer = setTimeout(go, wait).unref()
        this.wake.set(device, go)
      })
      this.seen.set(device, Date.now())
    }
    const asks = this.queues.get(device) ?? []
    this.queues.delete(device)
    return asks
  }

  /** 只收发给这台电脑的请求的回答。 */
  answer(device: string, id: string, answer: FileAnswer) {
    const waiter = this.waiting.get(id)
    if (!waiter || waiter.device !== device) return false
    waiter.done(answer)
    return true
  }
}

type HostedSession = { session: { cwd: string; worktreeCwd?: string; blocks: unknown[] } }

/** 主机上的会话：网关和它在同一台机器上，自己读。 */
async function hostFile(sessionId: string, path: string, mtime: number | undefined, preview: boolean, host: HostCall): Promise<FileAnswer> {
  const value = (await host('sessions.get', { sessionId })) as HostedSession
  return readSharedFile(path, { cwd: value.session.cwd, worktreeCwd: value.session.worktreeCwd, blocksJson: JSON.stringify(value.session.blocks) }, mtime, preview)
}

/** 主机上的会话的本地服务：列出来 / 打开一个。 */
async function hostServices(sessionId: string, port: number | undefined, host: HostCall) {
  const { session } = (await host('sessions.get', { sessionId })) as HostedSession
  const roots = [session.cwd, session.worktreeCwd].filter((r): r is string => !!r)
  const all = await listeners()
  const mentioned = mentionedPorts(JSON.stringify(session.blocks))
  return port === undefined ? projectServices(all, roots, mentioned) : openService(port, projectListeners(all, roots, mentioned))
}

/**
 * 这个项目所在、开着的那台电脑：有几台时按手机给的 machine，没给就挑最近推过会话的。
 * need = data：数据进程能答数据请求的；ui：界面开着、在取手机消息的（开工要界面开会话）。
 */
function projectComputer(store: GatewayStore, files: FileRelay, cwd: string, machine: unknown, need: 'data' | 'ui') {
  const owners = store.db.prepare('SELECT device_id, machine, MAX(pushed_at) AS at FROM mirror_sessions WHERE repo_key = ? GROUP BY device_id ORDER BY at DESC')
    .all(repoKey(cwd)) as { device_id: string; machine: string }[]
  const alive = owners.filter((o) => (need === 'data' ? files.alive(o.device_id, true) : store.online(o.device_id)))
  const owner = alive.find((o) => o.machine === machine) ?? alive[0]
  if (!owner) throw new Error('The computer is offline')
  return owner
}

/**
 * 从 issue 开工（SOL-100）：交给那台电脑的界面，在新会话里把提示词直接发出去，再把会话挂到 issue 上。
 * 提示词手机拼好、用户可以改；带仓库的在那个仓库的新工作树里开。
 */
function startWork(store: GatewayStore, files: FileRelay, params: Record<string, unknown>) {
  const cwd = text(params.cwd, 'cwd')
  if (!isAbsolute(cwd)) throw new Error('Invalid cwd')
  const owner = projectComputer(store, files, cwd, params.machine, 'ui')
  const workCwd = params.workCwd === undefined || params.workCwd === null ? undefined : text(params.workCwd, 'work cwd')
  const model = params.model && typeof params.model === 'object' ? (params.model as Record<string, unknown>) : undefined
  return store.relayAction(owner.device_id, {
    kind: 'startWork', cwd, prompt: text(params.prompt, 'prompt', 100_000), issueId: Number(params.issueId),
    ...(workCwd ? { workCwd } : {}),
    ...(model ? { model: { harness: text(model.harness, 'harness', 100), model: text(model.model, 'model', 300), settings: model.settings ?? {} } } : {}),
  }, text(params.commandId, 'command id', 200))
}

/**
 * 手机要的 issue 数据（SOL-100）：交给这个项目所在、开着的那台电脑（数据进程只认 phone.ts 白名单里的方法）。
 * 几台电脑都有这个项目时，按手机给的 machine，没给就挑最近推过会话的那台。
 */
async function data(store: GatewayStore, files: FileRelay, params: Record<string, unknown>) {
  const cwd = text(params.cwd, 'cwd')
  if (!isAbsolute(cwd)) throw new Error('Invalid cwd')
  const method = text(params.method, 'method', 64)
  const args = Array.isArray(params.args) ? params.args : []
  const owner = projectComputer(store, files, cwd, params.machine, 'data')
  // cwd 只用来找是哪台电脑；方法的参数原样转过去
  const answer = await files.ask(owner.device_id, { kind: 'data', method, args })
  if ('error' in answer) throw new Error(answer.error)
  return 'result' in answer ? answer.result : null
}

/** 手机列 / 打开本地服务：电脑上的会话问那台电脑，主机上的自己做。 */
async function services(store: GatewayStore, files: FileRelay, params: Record<string, unknown>, host: HostCall) {
  const id = text(params.id, 'session id', 200)
  const port = params.port === undefined ? undefined : Number(params.port)
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('Invalid port')
  if (params.source === 'host') return hostServices(id, port, host)
  const owner = (store.db.prepare('SELECT device_id FROM mirror_sessions WHERE id = ?').get(id) as { device_id: string } | undefined)?.device_id
  if (!owner) throw new Error('Session not found')
  if (!files.alive(owner)) throw new Error('The computer is offline')
  const answer = await files.ask(owner, port === undefined ? { kind: 'services', sessionId: id } : { kind: 'open', sessionId: id, port })
  if ('error' in answer) throw new Error(answer.error)
  return 'result' in answer ? answer.result : null
}

/** 手机最近一次来等通知的时间：两分钟内来过才去问主机，没人等就不问。 */
let phoneWaiting = 0

/**
 * 主机上的会话（手机上开的、服务器上跑的）：隔几秒问一次主机服务，在跑 → 停了、开始等你处理时记成通知事件（SOL-104）。
 * 头一次看到的会话只记下状态，不算变化。返回停止函数。
 */
export function watchHost(store: GatewayStore, host: HostCall, every = 5000) {
  const seen = new Map<string, { running: boolean; input: boolean }>()
  let busy = false
  const tick = async () => {
    if (busy || Date.now() - phoneWaiting > 120_000) return
    busy = true
    try {
      const projects = (await host('projects.list', {})) as { id: string; cwd: string }[]
      for (const project of projects) {
        const sessions = (await host('sessions.list', { projectId: project.id })) as HostSummary[]
        for (const s of sessions) {
          if (s.archived || s.draft) continue
          const now = { running: s.status === 'running', input: !!s.needsInput }
          const before = seen.get(s.id)
          seen.set(s.id, now)
          if (!before) continue
          const base = { source: 'host' as const, sessionId: s.id, title: s.title, cwd: project.cwd, projectId: project.id }
          if (before.running && !now.running) {
            const full = (await host('sessions.get', { sessionId: s.id }).catch(() => null)) as { session?: { blocks?: unknown } } | null
            store.addEvent({ ...base, kind: 'done', body: lastReply(full?.session?.blocks) })
          } else if (!before.input && now.input) store.addEvent({ ...base, kind: 'input', body: '' })
        }
      }
    } catch (e) {
      console.error(`watch host: ${(e as Error).message}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void tick(), every)
  timer.unref()
  return () => clearInterval(timer)
}

/** 测试用：当作手机刚来等过通知。 */
export const markPhoneWaiting = () => (phoneWaiting = Date.now())

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('Request too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

const readBody = async (req: IncomingMessage, limit: number) => (await readRaw(req, limit)).toString('utf8')

async function soloyard(store: GatewayStore, files: FileRelay, device: Device, method: string, params: Record<string, unknown>, host: HostCall) {
  switch (method) {
    case 'soloyard.describe':
      return { protocol: PROTOCOL, name: hostname(), device }
    case 'soloyard.mirror.push': {
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can push sessions')
      const { stored, touched } = store.push(device, params)
      // 不让电脑等主机：出错了下次推送再判断
      if (touched.length) void store.releaseContinued(touched, host).catch((e: Error) => console.error(`release continued: ${e.message}`))
      return { stored }
    }
    case 'soloyard.mirror.live':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can push sessions')
      return store.live(device, params)
    case 'soloyard.events.wait':
      if (device.kind !== 'phone') throw new Error('Only a phone can wait for events')
      phoneWaiting = Date.now()
      // 手机最近一次来等通知（排查「收不到通知」用：presence 表里能看到手机连没连着）
      store.db.prepare('INSERT INTO presence (device_id, seen_at) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET seen_at = excluded.seen_at')
        .run(device.id, phoneWaiting)
      return store.waitEvents(params.after, typeof params.wait === 'number' ? Math.min(Math.max(params.wait, 0), 30_000) : undefined)
    case 'soloyard.mirror.list': {
      if (params.repoKey !== undefined) return store.list(text(params.repoKey, 'repoKey', 1000))
      const cwd = text(params.cwd, 'cwd')
      if (!isAbsolute(cwd)) throw new Error('Invalid cwd')
      return store.list(repoKey(cwd))
    }
    case 'soloyard.mirror.get':
      return store.get(text(params.id, 'session id', 200), params.revision, params.tail)
    case 'soloyard.mirror.send':
      if (device.kind !== 'phone') throw new Error('Only a phone can send to a desktop session')
      return store.relay(text(params.id, 'session id', 200), text(params.text, 'message', 100_000), text(params.commandId, 'command id', 200))
    case 'soloyard.mirror.stopJob':
      if (device.kind !== 'phone') throw new Error('Only a phone can stop a desktop job')
      return store.relay(text(params.id, 'session id', 200), '', text(params.commandId, 'command id', 200), text(params.jobId, 'job id', 200))
    case 'soloyard.mirror.jobs':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can push sessions')
      return store.jobs(device, text(params.id, 'session id', 200), params.jobs)
    case 'soloyard.relay.pull':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can pull messages')
      return store.pull(device)
    case 'soloyard.files.pull':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can serve files')
      return files.pull(device.id, undefined, params.data === true)
    case 'soloyard.relay.answer':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can answer')
      return {
        ok: files.answer(device.id, text(params.id, 'id', 64), typeof params.error === 'string' ? { error: params.error } : { result: params.result }),
      }
    case 'soloyard.data':
      if (device.kind !== 'phone') throw new Error('Only a phone can ask for data')
      return data(store, files, params)
    case 'soloyard.startWork':
      if (device.kind !== 'phone') throw new Error('Only a phone can start work')
      return startWork(store, files, params)
    case 'soloyard.services.list':
    case 'soloyard.services.open':
      if (device.kind !== 'phone') throw new Error('Only a phone can open services')
      return services(store, files, method === 'soloyard.services.open' ? params : { ...params, port: undefined }, host)
    case 'soloyard.mirror.files': {
      const r = store.db.prepare('SELECT cwd, session_json FROM mirror_sessions WHERE id = ?').get(text(params.id, 'session id', 200)) as Row | undefined
      if (!r) throw new Error('Session not found')
      const session = JSON.parse(String(r.session_json)) as { blocks: []; worktreeCwd?: string }
      return sessionFiles(session.blocks, session.worktreeCwd || String(r.cwd))
    }
    case 'soloyard.mirror.continue':
      if (device.kind !== 'phone') throw new Error('Only a phone can continue sessions on the host')
      return store.continueOnHost(text(params.id, 'session id', 200), host)
    case 'soloyard.host.list':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can take sessions back')
      return hostSessions(store, text(params.repoKey, 'repoKey', 1000), host)
    case 'soloyard.host.take':
      if (device.kind !== 'desktop') throw new Error('Only a paired desktop can take sessions back')
      return takeFromHost(store, text(params.sessionId, 'session id', 200), host)
    default:
      throw new Error(`Unknown method ${method}`)
  }
}

export type GatewayOptions = { dataDir: string; listen?: string; hostUrl?: string }

export async function startGateway({ dataDir, listen = '127.0.0.1:3775', hostUrl = 'http://127.0.0.1:3774' }: GatewayOptions) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const store = new GatewayStore(join(dataDir, 'gateway.db'))
  const files = new FileRelay()
  chmodSync(join(dataDir, 'gateway.db'), 0o600)
  // 每次转发时读：在主机上重新配了网关的凭据，不用重启网关
  const hostToken = () => (JSON.parse(readFileSync(join(dataDir, 'host-device.json'), 'utf8')) as { token: string }).token
  const toHost = (body: string) =>
    fetch(`${hostUrl}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hostToken()}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    })
  const LOST = 'The gateway is no longer paired with the host. Run monocode-host pair for the gateway again.'
  // 网关自己调主机（接着聊等）：主机认 environmentId，先问一次它是谁
  let environmentId: string | undefined
  const host: HostCall = async (method, params) => {
    const call = async (m: string, p: unknown) => {
      const response = await toHost(JSON.stringify({ version: PROTOCOL, environmentId, method: m, params: p }))
      if (response.status === 401) throw new Error(LOST)
      const body = (await response.json()) as { result?: unknown; error?: string }
      if (body.error) throw new Error(body.error)
      return body.result
    }
    environmentId ??= ((await call('environment.describe', {})) as { environmentId: string }).environmentId
    return call(method, params)
  }

  const stopWatch = watchHost(store, host)
  const server: Server = createServer({ requestTimeout: 60_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // 手机走 Tailscale 的海外中继时很慢，JSON 压一下能小到三分之一
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    const send = (status: number, body: unknown) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      if (!gzip || text.length < 1024) return res.writeHead(status).end(text)
      res.setHeader('Content-Encoding', 'gzip')
      res.writeHead(status).end(gzipSync(text))
    }
    // 和 monocode-host 一样：只给原生客户端用，浏览器来的（带 Origin）一律拒
    const fileRoute = /^\/file(?:\/([\w-]{1,64}))?$/.exec(req.url ?? '')
    if (req.headers.origin || req.method !== 'POST' || (req.url !== '/rpc' && !fileRoute)) return send(403, { error: 'Unsupported request origin or route' })
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1]
    const device = token ? store.device(token) : undefined
    if (!device) return send(401, { error: 'Device credential is invalid or revoked' })

    if (fileRoute?.[1]) {
      // 电脑交回读好的文件：内容是请求体，文件信息 / 读不了的原因在头里
      if (device.kind !== 'desktop') return send(403, { error: 'Only a paired desktop can serve files' })
      try {
        const head = (name: string) => decodeURIComponent(String(req.headers[name] ?? ''))
        const body = await readRaw(req, MAX_FILE + 1024)
        const answer: FileAnswer = req.headers['x-soloyard-error']
          ? { error: head('x-soloyard-error') }
          : { ...(JSON.parse(head('x-soloyard-file')) as Omit<SharedFile, 'data'>), ...(body.length || req.headers['x-soloyard-unchanged'] !== '1' ? { data: body } : {}) }
        return send(files.answer(device.id, fileRoute[1], answer) ? 200 : 404, { ok: true })
      } catch (e) {
        return send(400, { error: (e as Error).message })
      }
    }
    if (fileRoute) {
      // 手机要文件：{ source: 'mirror' | 'host', id, path, mtime }。回原始内容，文件信息在 X-Soloyard-File 头里；没变回 304
      if (device.kind !== 'phone') return send(403, { error: 'Only a phone can fetch files' })
      let answer: FileAnswer
      try {
        const ask = JSON.parse(await readBody(req, 64 << 10)) as { source?: string; id?: unknown; path?: unknown; mtime?: unknown; preview?: unknown }
        const id = text(ask.id, 'session id', 200)
        const path = text(ask.path, 'path')
        const mtime = typeof ask.mtime === 'number' ? ask.mtime : undefined
        // 看图要缩小版（走中继时原图太大），分享、存到手机时要原图
        const preview = ask.preview === true
        if (ask.source === 'host') answer = await hostFile(id, path, mtime, preview, host)
        else {
          const owner = (store.db.prepare('SELECT device_id FROM mirror_sessions WHERE id = ?').get(id) as { device_id: string } | undefined)?.device_id
          if (!owner) throw new Error('Session not found')
          if (!files.alive(owner)) return send(409, { error: 'The computer is offline' })
          answer = await files.ask(owner, { kind: 'file', sessionId: id, path, mtime, preview })
        }
      } catch (e) {
        return send(400, { error: (e as Error).message })
      }
      if ('error' in answer) return send(404, { error: answer.error })
      if ('result' in answer) return send(502, { error: 'Unexpected answer' })
      const { data, ...meta } = answer
      res.setHeader('X-Soloyard-File', encodeURIComponent(JSON.stringify(meta)))
      if (!data) return res.writeHead(304).end()
      res.setHeader('Content-Type', meta.mime)
      // 网页、脚本这些文本压一下，走海外中继时差很多
      if (gzip && data.length > 1024 && /^text\/|json|xml|svg|javascript/.test(meta.mime)) {
        res.setHeader('Content-Encoding', 'gzip')
        return res.writeHead(200).end(gzipSync(data))
      }
      return res.writeHead(200).end(data)
    }

    let raw: string
    let input: { version?: unknown; method?: unknown; params?: unknown }
    try {
      // 电脑推会话可能很大（长对话），其余请求都很小
      raw = await readBody(req, device.kind === 'desktop' ? 64 << 20 : 2 << 20)
      input = JSON.parse(raw)
    } catch (e) {
      return send(400, { error: (e as Error).message })
    }
    if (input.version !== PROTOCOL) return send(400, { error: 'Incompatible protocol version' })
    const method = String(input.method ?? '')
    const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {}

    if (method.startsWith('soloyard.')) {
      try {
        return send(200, { result: await soloyard(store, files, device, method, params, host) })
      } catch (e) {
        return send(400, { error: (e as Error).message })
      }
    }
    if (device.kind !== 'phone') return send(403, { error: 'This device can only sync sessions' })
    try {
      const response = await toHost(raw)
      // 网关自己的主机凭据失效是主机这边的事，别让手机以为它自己被吊销了
      if (response.status === 401) return send(502, { error: LOST })
      return send(response.status, await response.text())
    } catch (e) {
      return send(502, { error: `Host unreachable: ${(e as Error).message}` })
    }
  })

  const at = listen.lastIndexOf(':')
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(Number(listen.slice(at + 1)), listen.slice(0, at), ok)
  })
  server.on('close', stopWatch)
  const address = server.address()
  const url = typeof address === 'object' && address ? `http://${address.address}:${address.port}` : listen
  return { server, store, url }
}

// ---------- 命令行 ----------
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const flag = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
  }
  const dataDir = flag('data-dir', join(homedir(), '.soloyard-host'))
  const command = args[0]
  if (command === 'serve') {
    const { url } = await startGateway({ dataDir, listen: flag('listen', '127.0.0.1:3775'), hostUrl: flag('host-url', 'http://127.0.0.1:3774') })
    console.log(`Soloyard gateway listening on ${url}`)
  } else if (command === 'pair' || command === 'devices' || command === 'revoke') {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    const store = new GatewayStore(join(dataDir, 'gateway.db'))
    if (command === 'pair') {
      const device = store.pair(flag('name', 'Phone'), args.includes('--desktop') ? 'desktop' : 'phone')
      console.log(JSON.stringify(device, null, args.includes('--json') ? undefined : 2))
    } else if (command === 'devices') console.log(JSON.stringify(store.devices(), null, 2))
    else console.log(store.revoke(args[1] ?? '') ? 'Device revoked' : 'No such device')
  } else {
    console.error('usage: gateway.ts serve | pair --name <名字> [--desktop] | devices | revoke <id>   [--data-dir <目录>]')
    process.exit(2)
  }
}
