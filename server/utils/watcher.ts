import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { getRepos } from './repos'

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

  // Build watch paths
  watchedPaths = repos.flatMap(repo => [
    `${repo.path}/docs/prd/*.md`,
    `${repo.path}/.claude/state/*/tasks.json`,
    `${repo.path}/.claude/state/*/progress.json`
  ])

  watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    }
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

    const event: FileChangeEvent = {
      type: eventType,
      path: filePath,
      repoId,
      category
    }

    emitDebounced(event)
  })

  console.log('[watcher] File watcher initialized')
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
