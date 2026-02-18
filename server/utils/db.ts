import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

type SqlParam = string | number | bigint | Uint8Array | null
type SqlRow = Record<string, unknown>

type SqlRunResult = {
  changes: number
}

type SqliteAdapter = {
  exec: (sql: string) => void
  run: (sql: string, params?: SqlParam[]) => SqlRunResult
  get: <T extends SqlRow>(sql: string, params?: SqlParam[]) => T | null
  all: <T extends SqlRow>(sql: string, params?: SqlParam[]) => T[]
}

const DEFAULT_DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const DEFAULT_DB_PATH = join(DEFAULT_DATA_HOME, 'prd', 'state.db')

let adapterPromise: Promise<SqliteAdapter> | null = null

function coerceChanges(result: unknown): number {
  if (!result || typeof result !== 'object') {
    return 0
  }

  const maybeChanges = (result as { changes?: unknown }).changes
  return typeof maybeChanges === 'number' ? maybeChanges : 0
}

function resolveDbPath(): string {
  const customPath = process.env.PRD_STATE_DB_PATH
  if (customPath && customPath.trim().length > 0) {
    return customPath
  }

  const customHome = process.env.PRD_STATE_HOME
  if (customHome && customHome.trim().length > 0) {
    return join(customHome, 'state.db')
  }

  return DEFAULT_DB_PATH
}

export function getDbPath(): string {
  return resolveDbPath()
}

async function createNodeAdapter(dbPath: string): Promise<SqliteAdapter> {
  const sqliteModule = await import('node:sqlite')
  const db = new sqliteModule.DatabaseSync(dbPath)

  return {
    exec(sql: string) {
      db.exec(sql)
    },
    run(sql: string, params: SqlParam[] = []) {
      const result = db.prepare(sql).run(...params)
      return { changes: coerceChanges(result) }
    },
    get<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      const row = db.prepare(sql).get(...params)
      return row ? (row as T) : null
    },
    all<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[]
    }
  }
}

async function createBunAdapter(dbPath: string): Promise<SqliteAdapter> {
  const bunModuleName = 'bun:sqlite'
  const sqliteModule = await import(bunModuleName)
  const Database = (sqliteModule as { Database: new (path: string, options?: { create?: boolean }) => {
    exec: (sql: string) => void
    query: (sql: string) => {
      run: (...params: SqlParam[]) => unknown
      get: (...params: SqlParam[]) => SqlRow | null
      all: (...params: SqlParam[]) => SqlRow[]
    }
  } }).Database

  const db = new Database(dbPath, { create: true })

  return {
    exec(sql: string) {
      db.exec(sql)
    },
    run(sql: string, params: SqlParam[] = []) {
      const result = db.query(sql).run(...params)
      return { changes: coerceChanges(result) }
    },
    get<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      const row = db.query(sql).get(...params) as T | null | undefined
      return row ?? null
    },
    all<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      return db.query(sql).all(...params) as T[]
    }
  }
}

async function initializeDatabase(): Promise<SqliteAdapter> {
  const dbPath = resolveDbPath()
  await fs.mkdir(dirname(dbPath), { recursive: true })

  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
  const adapter = isBunRuntime
    ? await createBunAdapter(dbPath)
    : await createNodeAdapter(dbPath)

  adapter.exec('PRAGMA journal_mode = WAL;')
  adapter.exec('PRAGMA foreign_keys = ON;')
  adapter.exec('PRAGMA busy_timeout = 5000;')

  adapter.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL,
      git_repos_json TEXT
    );

    CREATE TABLE IF NOT EXISTS prd_states (
      repo_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      tasks_json TEXT,
      progress_json TEXT,
      notes_md TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (repo_id, slug),
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prd_states_repo_id ON prd_states(repo_id);
  `)

  return adapter
}

async function getAdapter(): Promise<SqliteAdapter> {
  if (!adapterPromise) {
    adapterPromise = initializeDatabase()
  }
  return adapterPromise
}

export async function dbRun(sql: string, params: SqlParam[] = []): Promise<SqlRunResult> {
  const adapter = await getAdapter()
  return adapter.run(sql, params)
}

export async function dbGet<T extends SqlRow>(sql: string, params: SqlParam[] = []): Promise<T | null> {
  const adapter = await getAdapter()
  return adapter.get<T>(sql, params)
}

export async function dbAll<T extends SqlRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  const adapter = await getAdapter()
  return adapter.all<T>(sql, params)
}

export async function dbExec(sql: string): Promise<void> {
  const adapter = await getAdapter()
  adapter.exec(sql)
}
