import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Soloyard 的数据放在应用自己的库（monocode.db）里：表一律 soloyard_ 前缀，迁移记录在 soloyard_migrations，
 * 不碰上游的表和 schema_migrations。应用（经 sidecar）和 MCP 服务是不同进程，同时写同一个文件，靠 WAL + busy_timeout。
 */
export type DB = DatabaseSync

/** 按顺序追加，已发布的迁移不要改；新增表 / 列就在末尾加一条。 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE soloyard_projects (
    id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'scribble', archived INTEGER NOT NULL DEFAULT 0, next_step TEXT NOT NULL DEFAULT '',
    stoploss_json TEXT, meta_json TEXT, issue_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE soloyard_project_paths (
    project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, path TEXT NOT NULL,
    recursive INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (project_id, path));
  CREATE TABLE soloyard_ideas (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'inbox',
    reject_reason TEXT, project_id INTEGER REFERENCES soloyard_projects(id) ON DELETE SET NULL, source TEXT NOT NULL DEFAULT 'user',
    snooze_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE soloyard_documents (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'free', slug TEXT, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', blocks_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE (project_id, slug));
  CREATE TABLE soloyard_decisions (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, code TEXT NOT NULL,
    title TEXT NOT NULL, door TEXT, status TEXT NOT NULL DEFAULT 'pending', data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE (project_id, code));
  CREATE TABLE soloyard_evidence (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, code TEXT NOT NULL,
    level TEXT, verified TEXT, data_json TEXT NOT NULL DEFAULT '{}', UNIQUE (project_id, code));
  CREATE TABLE soloyard_features (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, code TEXT NOT NULL,
    backbone TEXT, module TEXT, name TEXT NOT NULL, layer TEXT, level TEXT, tier TEXT, choice TEXT, data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE (project_id, code));
  CREATE TABLE soloyard_milestones (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
    target_date TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE soloyard_cycles (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
    start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE soloyard_issues (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE, number INTEGER NOT NULL,
    title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'backlog', priority INTEGER NOT NULL DEFAULT 0,
    labels TEXT NOT NULL DEFAULT '[]', due_date TEXT,
    cycle_id INTEGER REFERENCES soloyard_cycles(id) ON DELETE SET NULL,
    milestone_id INTEGER REFERENCES soloyard_milestones(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES soloyard_issues(id) ON DELETE CASCADE,
    feature_id INTEGER REFERENCES soloyard_features(id) ON DELETE SET NULL,
    sort_key REAL NOT NULL DEFAULT 0, completed_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE (project_id, number));
  CREATE TABLE soloyard_issue_deps (
    issue_id INTEGER NOT NULL REFERENCES soloyard_issues(id) ON DELETE CASCADE,
    blocked_by_id INTEGER NOT NULL REFERENCES soloyard_issues(id) ON DELETE CASCADE, PRIMARY KEY (issue_id, blocked_by_id));
  CREATE TABLE soloyard_acceptance (
    id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES soloyard_issues(id) ON DELETE CASCADE, text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE soloyard_comments (
    id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES soloyard_issues(id) ON DELETE CASCADE, actor TEXT NOT NULL,
    body_md TEXT NOT NULL, created_at TEXT NOT NULL);
  -- 会话关联：一个会话（底座 sessions.id）可以挂多个对象（issue、文档、文件夹……），关联本身就是会话上下文。
  CREATE TABLE soloyard_session_links (
    session_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, kind, target));
  CREATE TABLE soloyard_changes (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
    op TEXT NOT NULL, before_json TEXT, after_json TEXT, batch TEXT);
  CREATE INDEX soloyard_issues_project ON soloyard_issues(project_id, status);
  CREATE INDEX soloyard_changes_entity ON soloyard_changes(entity, entity_id);
  CREATE INDEX soloyard_session_links_target ON soloyard_session_links(kind, target);
  `,
  // 迭代 = 带版本号的规划表（功能全景 + 减法 + 迭代合一）。tag 是版本号（v1.0）；version 列照例是乐观锁。
  // 功能不在任何迭代时落在 bucket：pending 待定 / split 另立项 / cut 不做；迭代被删（SET NULL）就自然回到 bucket。
  // ai_plan = AI 原本的安排（版本号或 bucket），界面据此标「AI：v1.0」。
  `
  CREATE TABLE soloyard_iterations (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES soloyard_projects(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', target_date TEXT,
    status TEXT NOT NULL DEFAULT 'planned', sort REAL NOT NULL DEFAULT 0, summary_json TEXT, started_at TEXT, completed_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  ALTER TABLE soloyard_features ADD COLUMN iteration_id INTEGER REFERENCES soloyard_iterations(id) ON DELETE SET NULL;
  ALTER TABLE soloyard_features ADD COLUMN bucket TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE soloyard_features ADD COLUMN ai_plan TEXT;
  ALTER TABLE soloyard_features ADD COLUMN sort REAL NOT NULL DEFAULT 0;
  ALTER TABLE soloyard_issues ADD COLUMN iteration_id INTEGER REFERENCES soloyard_iterations(id) ON DELETE SET NULL;
  CREATE INDEX soloyard_iterations_project ON soloyard_iterations(project_id, sort);
  CREATE INDEX soloyard_features_iteration ON soloyard_features(project_id, iteration_id);
  `,
]

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS soloyard_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const current = () => Number((db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM soloyard_migrations').get() as { v: number }).v)
  for (let v = 1; v <= MIGRATIONS.length; v++) {
    // 在写事务里再读一次版本：应用和 MCP 同时首次启动时，后到的那个看到已迁移就跳过
    tx(db, () => {
      if (current() >= v) return
      db.exec(MIGRATIONS[v - 1])
      db.prepare('INSERT INTO soloyard_migrations (version, applied_at) VALUES (?, ?)').run(v, new Date().toISOString())
    })
  }
}

/** 事务：要么全成要么全不成。 */
export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn() // 已在外层事务里：并入外层，一起提交或回滚
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
