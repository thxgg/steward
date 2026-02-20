// @ts-nocheck
import { Database } from 'bun:sqlite'
import { join, resolve, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const DEFAULT_DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const DEFAULT_DB_PATH = join(DEFAULT_DATA_HOME, 'prd', 'state.db')
const customPath = process.env.PRD_STATE_DB_PATH
const customHome = process.env.PRD_STATE_HOME

const DB_PATH = customPath && customPath.trim().length > 0
  ? customPath
  : (customHome && customHome.trim().length > 0 ? join(customHome, 'state.db') : DEFAULT_DB_PATH)

// Find the repo root by walking up until we find docs/prd
function findRepoRoot(startPath: string): string | null {
  let current = resolve(startPath)
  while (current !== '/') {
    if (existsSync(join(current, 'docs', 'prd'))) {
      return current
    }
    current = dirname(current)
  }
  return null
}

function getDb(): Database {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH, { create: true })

  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')

  // Create tables if they don't exist
  db.exec(`
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

  return db
}

function registerRepo(path: string, name?: string): { id: string, name: string, path: string } {
  const db = getDb()
  const resolvedPath = resolve(path)

  const existing = db.query('SELECT id, name, path FROM repos WHERE path = ?').get(resolvedPath) as any
  if (existing) {
    console.log(`Repo already registered: ${existing.id}`)
    return existing
  }

  const repoName = name || basename(resolvedPath)
  const id = randomUUID()
  const addedAt = new Date().toISOString()

  db.query('INSERT INTO repos (id, name, path, added_at) VALUES (?, ?, ?, ?)').run(id, repoName, resolvedPath, addedAt)
  console.log(`Registered new repo: ${id} (${repoName})`)

  return { id, name: repoName, path: resolvedPath }
}

function getState(repoPath: string, slug: string, outDir: string) {
  const db = getDb()
  const rootPath = findRepoRoot(repoPath) || resolve(repoPath)

  const repo = db.query('SELECT id FROM repos WHERE path = ?').get(rootPath) as any
  if (!repo) {
    console.error(`Repository not found in DB for path: ${rootPath}`)
    console.error('Run register command first.')
    process.exit(1)
  }

  const state = db.query('SELECT tasks_json, progress_json, notes_md FROM prd_states WHERE repo_id = ? AND slug = ?').get(repo.id, slug) as any

  mkdirSync(outDir, { recursive: true })

  if (state?.tasks_json) {
    writeFileSync(join(outDir, 'tasks.json'), state.tasks_json)
    console.log(`Wrote tasks.json to ${outDir}`)
  } else {
    writeFileSync(join(outDir, 'tasks.json'), JSON.stringify({ prd: { name: slug }, tasks: [] }, null, 2))
    console.log(`Initialized empty tasks.json in ${outDir}`)
  }

  if (state?.progress_json) {
    writeFileSync(join(outDir, 'progress.json'), state.progress_json)
    console.log(`Wrote progress.json to ${outDir}`)
  } else {
    writeFileSync(join(outDir, 'progress.json'), JSON.stringify({ prdName: slug, patterns: [], taskLogs: [] }, null, 2))
    console.log(`Initialized empty progress.json in ${outDir}`)
  }

  if (state?.notes_md) {
    writeFileSync(join(outDir, 'notes.md'), state.notes_md)
    console.log(`Wrote notes.md to ${outDir}`)
  }
}

function saveState(repoPath: string, slug: string, tasksFile: string, progressFile: string, notesFile?: string) {
  const db = getDb()
  const rootPath = findRepoRoot(repoPath) || resolve(repoPath)

  let repo = db.query('SELECT id FROM repos WHERE path = ?').get(rootPath) as any
  if (!repo) {
    // Auto-register if missing
    repo = registerRepo(rootPath)
  }

  let tasksJson = null
  let progressJson = null
  let notesMd = null

  if (existsSync(tasksFile)) tasksJson = readFileSync(tasksFile, 'utf8')
  if (existsSync(progressFile)) progressJson = readFileSync(progressFile, 'utf8')
  if (notesFile && existsSync(notesFile)) notesMd = readFileSync(notesFile, 'utf8')

  const existing = db.query('SELECT 1 FROM prd_states WHERE repo_id = ? AND slug = ?').get(repo.id, slug)
  const updatedAt = new Date().toISOString()

  if (existing) {
    db.query(`
      UPDATE prd_states
      SET tasks_json = ?, progress_json = ?, notes_md = ?, updated_at = ?
      WHERE repo_id = ? AND slug = ?
    `).run(tasksJson, progressJson, notesMd, updatedAt, repo.id, slug)
    console.log(`Updated state for ${slug}`)
  } else {
    db.query(`
      INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(repo.id, slug, tasksJson, progressJson, notesMd, updatedAt)
    console.log(`Created state for ${slug}`)
  }
}

const command = process.argv[2]

if (command === 'register') {
  const path = process.argv[3]
  const name = process.argv[4]
  if (!path) {
    console.error('Usage: prd-db.ts register <path> [name]')
    process.exit(1)
  }
  registerRepo(path, name)
} else if (command === 'get-state') {
  const path = process.argv[3]
  const slug = process.argv[4]
  const outDir = process.argv[5]
  if (!path || !slug || !outDir) {
    console.error('Usage: prd-db.ts get-state <repo-path> <slug> <out-dir>')
    process.exit(1)
  }
  getState(path, slug, outDir)
} else if (command === 'save-state') {
  const path = process.argv[3]
  const slug = process.argv[4]
  const tasksFile = process.argv[5]
  const progressFile = process.argv[6]
  const notesFile = process.argv[7]
  if (!path || !slug || !tasksFile || !progressFile) {
    console.error('Usage: prd-db.ts save-state <repo-path> <slug> <tasks-file> <progress-file> [notes-file]')
    process.exit(1)
  }
  saveState(path, slug, tasksFile, progressFile, notesFile)
} else {
  console.error('Unknown command. Available commands: register, get-state, save-state')
  process.exit(1)
}
