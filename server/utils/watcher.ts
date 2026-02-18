import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { getRepos } from './repos'
import { migrateLegacyStateForRepo } from './prd-state'

export type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink'
  path: string
  repoId: string
  category: 'prd' | 'tasks' | 'progress'
}

type Listener = (event: FileChangeEvent) => void

// Singleton watcher instance
let watcher: FSWatcher | null = null
const listeners = new Set<Listener>()
let watchedPaths: string[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingEvents: FileChangeEvent[] = []

// Debounce delay in ms
const DEBOUNCE_MS = 300

function getRepoIdFromPath(filePath: string, repos: { id: string; path: string }[]): string | null {
  for (const repo of repos) {
    if (filePath.startsWith(repo.path)) {
      return repo.id
    }
  }
  return null
}

function getCategoryFromPath(filePath: string): FileChangeEvent['category'] | null {
  if (filePath.includes('/docs/prd/') && filePath.endsWith('.md')) {
    return 'prd'
  }
  // Legacy state files are still watched so they can be migrated into SQLite.
  if (filePath.includes('/.claude/state/') && filePath.endsWith('tasks.json')) {
    return 'tasks'
  }
  if (filePath.includes('/.claude/state/') && filePath.endsWith('progress.json')) {
    return 'progress'
  }
  return null
}

function emitDebounced(event: FileChangeEvent) {
  pendingEvents.push(event)

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    // Deduplicate events by path
    const uniqueEvents = new Map<string, FileChangeEvent>()
    for (const e of pendingEvents) {
      uniqueEvents.set(e.path, e)
    }

    // Emit to all listeners
    for (const e of uniqueEvents.values()) {
      for (const listener of listeners) {
        listener(e)
      }
    }

    pendingEvents = []
    debounceTimer = null
  }, DEBOUNCE_MS)
}

export async function initWatcher() {
  if (watcher) {
    return // Already initialized
  }

  const repos = await getRepos()
  if (repos.length === 0) {
    return // No repos to watch
  }

  // Build watch paths - docs + legacy state path for migration triggers.
  watchedPaths = repos.flatMap(repo => [
    `${repo.path}/docs/prd`,
    `${repo.path}/.claude/state`
  ])

  watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    persistent: true,
    depth: 2, // Watch subdirectories (state/<prd-name>/tasks.json)
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    },
    // Allow legacy .claude directory (chokidar ignores dotfiles by default)
    ignored: (path: string) => {
      // Never ignore paths containing .claude
      if (path.includes('.claude')) return false
      // Ignore other dotfiles
      const basename = path.split('/').pop() || ''
      return basename.startsWith('.') && basename !== '.claude'
    },
    followSymlinks: true
  })

  watcher.on('error', (error) => {
    console.error('[watcher] Error:', error)
  })

  watcher.on('all', async (eventType, filePath) => {
    if (eventType !== 'change' && eventType !== 'add' && eventType !== 'unlink') {
      return
    }

    const repos = await getRepos()
    const repoId = getRepoIdFromPath(filePath, repos)
    const category = getCategoryFromPath(filePath)

    if (!repoId || !category) {
      return
    }

    if (category === 'tasks' || category === 'progress') {
      const repo = repos.find(r => r.id === repoId)
      if (repo) {
        try {
          await migrateLegacyStateForRepo(repo, {
            cleanupLegacyFiles: false,
            minFileAgeMs: 0
          })
        } catch (error) {
          console.warn('[watcher] Failed to sync legacy state:', error)
        }
      }
    }

    const event: FileChangeEvent = {
      type: eventType,
      path: filePath,
      repoId,
      category
    }

    emitDebounced(event)
  })

  console.log('[watcher] File watcher initialized, watching', watchedPaths.length, 'directories')
}

export async function refreshWatcher() {
  // Close existing watcher
  if (watcher) {
    await watcher.close()
    watcher = null
  }

  // Re-initialize with updated repo list
  await initWatcher()
}

export function addListener(listener: Listener): () => void {
  listeners.add(listener)

  // Return cleanup function
  return () => {
    listeners.delete(listener)
  }
}

export function getWatcherStatus() {
  return {
    active: watcher !== null,
    watchedPaths,
    listenerCount: listeners.size
  }
}
