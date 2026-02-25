import { DatabaseSync } from 'node:sqlite'
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

function toNonNegativeNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(0, Math.floor(value))
}

function toCanonicalPattern(pattern) {
  if (typeof pattern === 'string') {
    const trimmed = pattern.trim()
    if (!trimmed) {
      return null
    }

    return {
      name: trimmed,
      description: trimmed
    }
  }

  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
    return null
  }

  const name = typeof pattern.name === 'string' ? pattern.name.trim() : ''
  if (!name) {
    return null
  }

  const description = typeof pattern.description === 'string' && pattern.description.trim().length > 0
    ? pattern.description.trim()
    : name

  return { name, description }
}

function toCanonicalTaskLogs(progress, now) {
  if (Array.isArray(progress.taskLogs)) {
    return progress.taskLogs.filter((entry) => {
      return entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.taskId === 'string'
    }).map((entry) => ({
      taskId: entry.taskId,
      status: entry.status === 'in_progress' || entry.status === 'completed' ? entry.status : 'pending',
      startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : now,
      ...(typeof entry.completedAt === 'string' && { completedAt: entry.completedAt }),
      ...(typeof entry.implemented === 'string' && { implemented: entry.implemented }),
      ...(Array.isArray(entry.filesChanged) && { filesChanged: entry.filesChanged.filter((file) => typeof file === 'string') }),
      ...(typeof entry.learnings === 'string' && { learnings: entry.learnings }),
      ...(Array.isArray(entry.commits) && {
        commits: entry.commits.filter((commit) => {
          if (typeof commit === 'string') {
            return commit.trim().length > 0
          }

          if (!commit || typeof commit !== 'object' || Array.isArray(commit)) {
            return false
          }

          return typeof commit.sha === 'string' && commit.sha.trim().length > 0 && typeof commit.repo === 'string'
        })
      })
    }))
  }

  if (progress.taskProgress && typeof progress.taskProgress === 'object' && !Array.isArray(progress.taskProgress)) {
    return Object.entries(progress.taskProgress).map(([taskId, value]) => ({
      taskId,
      status: value?.status === 'in_progress' || value?.status === 'completed' ? value.status : 'pending',
      startedAt: typeof value?.startedAt === 'string' ? value.startedAt : now,
      ...(typeof value?.completedAt === 'string' && { completedAt: value.completedAt }),
      ...(typeof value?.implemented === 'string' && { implemented: value.implemented }),
      ...(Array.isArray(value?.filesChanged) && { filesChanged: value.filesChanged.filter((file) => typeof file === 'string') }),
      ...(typeof value?.learnings === 'string' && { learnings: value.learnings }),
      ...(Array.isArray(value?.commits) && { commits: value.commits })
    }))
  }

  return []
}

function normalizeProgress(progressRaw, slug, tasksRaw) {
  const now = new Date().toISOString()

  const progress = progressRaw && typeof progressRaw === 'object' && !Array.isArray(progressRaw)
    ? progressRaw
    : {}

  const tasks = tasksRaw && typeof tasksRaw === 'object' && !Array.isArray(tasksRaw)
    ? tasksRaw
    : {}

  const taskCountHint = Array.isArray(tasks.tasks) ? tasks.tasks.length : 0
  const prdNameFallback = typeof tasks.prd?.name === 'string' && tasks.prd.name.trim().length > 0
    ? tasks.prd.name
    : slug

  const patterns = Array.isArray(progress.patterns)
    ? progress.patterns.map(toCanonicalPattern).filter((value) => value !== null)
    : []

  const taskLogs = toCanonicalTaskLogs(progress, now)

  const completed = typeof progress.completed === 'number'
    ? Math.max(0, Math.floor(progress.completed))
    : (Array.isArray(progress.completed) ? progress.completed.length : taskLogs.filter((entry) => entry.status === 'completed').length)

  const inProgress = toNonNegativeNumber(progress.inProgress)
    ?? taskLogs.filter((entry) => entry.status === 'in_progress').length

  const blocked = toNonNegativeNumber(progress.blocked) ?? 0

  const totalTasks = toNonNegativeNumber(progress.totalTasks)
    ?? toNonNegativeNumber(taskCountHint)
    ?? Math.max(completed + inProgress + blocked, taskLogs.length)

  return {
    prdName: typeof progress.prdName === 'string' && progress.prdName.trim().length > 0
      ? progress.prdName
      : prdNameFallback,
    totalTasks,
    completed,
    inProgress,
    blocked,
    startedAt: typeof progress.startedAt === 'string'
      ? progress.startedAt
      : (typeof progress.started === 'string' ? progress.started : null),
    lastUpdated: typeof progress.lastUpdated === 'string' && progress.lastUpdated.trim().length > 0
      ? progress.lastUpdated
      : now,
    patterns,
    taskLogs
  }
}

function createDefaultProgress(prdName, totalTasks = 0) {
  return {
    prdName,
    totalTasks,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    startedAt: null,
    lastUpdated: new Date().toISOString(),
    patterns: [],
    taskLogs: []
  }
}

function findRepoRoot(startPath) {
  let current = resolve(startPath)
  while (current !== '/') {
    if (existsSync(join(current, 'docs', 'prd'))) {
      return current
    }
    current = dirname(current)
  }
  return null
}

function getDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)

  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')

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

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  return db
}

function registerRepo(path, name) {
  const db = getDb()
  const resolvedPath = resolve(path)

  const existing = db.prepare('SELECT id, name, path FROM repos WHERE path = ?').get(resolvedPath)
  if (existing) {
    console.log(`Repo already registered: ${existing.id}`)
    return existing
  }

  const repoName = name || basename(resolvedPath)
  const id = randomUUID()
  const addedAt = new Date().toISOString()

  db.prepare('INSERT INTO repos (id, name, path, added_at) VALUES (?, ?, ?, ?)').run(id, repoName, resolvedPath, addedAt)
  console.log(`Registered new repo: ${id} (${repoName})`)

  return { id, name: repoName, path: resolvedPath }
}

function getState(repoPath, slug, outDir) {
  const db = getDb()
  const rootPath = findRepoRoot(repoPath) || resolve(repoPath)

  const repo = db.prepare('SELECT id FROM repos WHERE path = ?').get(rootPath)
  if (!repo) {
    console.error(`Repository not found in DB for path: ${rootPath}`)
    console.error('Run register command first.')
    process.exit(1)
  }

  const state = db.prepare('SELECT tasks_json, progress_json, notes_md FROM prd_states WHERE repo_id = ? AND slug = ?').get(repo.id, slug)

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
    writeFileSync(join(outDir, 'progress.json'), JSON.stringify(createDefaultProgress(slug), null, 2))
    console.log(`Initialized empty progress.json in ${outDir}`)
  }

  if (state?.notes_md) {
    writeFileSync(join(outDir, 'notes.md'), state.notes_md)
    console.log(`Wrote notes.md to ${outDir}`)
  }
}

function saveState(repoPath, slug, tasksFile, progressFile, notesFile) {
  const db = getDb()
  const rootPath = findRepoRoot(repoPath) || resolve(repoPath)

  let repo = db.prepare('SELECT id FROM repos WHERE path = ?').get(rootPath)
  if (!repo) {
    repo = registerRepo(rootPath)
  }

  let tasksJson = null
  let progressJson = null
  let notesMd = null

  if (existsSync(tasksFile)) {
    tasksJson = readFileSync(tasksFile, 'utf8')
  }

  if (existsSync(progressFile)) {
    const parsedTasks = tasksJson ? JSON.parse(tasksJson) : null
    const parsedProgress = JSON.parse(readFileSync(progressFile, 'utf8'))
    progressJson = JSON.stringify(normalizeProgress(parsedProgress, slug, parsedTasks))
  }
  if (notesFile && existsSync(notesFile)) notesMd = readFileSync(notesFile, 'utf8')

  const existing = db.prepare('SELECT 1 FROM prd_states WHERE repo_id = ? AND slug = ?').get(repo.id, slug)
  const updatedAt = new Date().toISOString()

  if (existing) {
    db.prepare(`
      UPDATE prd_states
      SET tasks_json = ?, progress_json = ?, notes_md = ?, updated_at = ?
      WHERE repo_id = ? AND slug = ?
    `).run(tasksJson, progressJson, notesMd, updatedAt, repo.id, slug)
    console.log(`Updated state for ${slug}`)
  } else {
    db.prepare(`
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
    console.error('Usage: prd-db.mjs register <path> [name]')
    process.exit(1)
  }
  registerRepo(path, name)
} else if (command === 'get-state') {
  const path = process.argv[3]
  const slug = process.argv[4]
  const outDir = process.argv[5]
  if (!path || !slug || !outDir) {
    console.error('Usage: prd-db.mjs get-state <repo-path> <slug> <out-dir>')
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
    console.error('Usage: prd-db.mjs save-state <repo-path> <slug> <tasks-file> <progress-file> [notes-file]')
    process.exit(1)
  }
  saveState(path, slug, tasksFile, progressFile, notesFile)
} else {
  console.error('Unknown command. Available commands: register, get-state, save-state')
  process.exit(1)
}
