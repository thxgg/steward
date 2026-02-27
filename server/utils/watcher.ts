import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  emitChange,
  getChangeListenerCount,
  getStateChangePollingStatus,
  startStateChangePolling,
  stopStateChangePolling,
  type FileChangeEvent
} from './change-events'
import { getRepos } from './repos'

// Singleton watcher instance
let watcher: FSWatcher | null = null
let watchedPaths: string[] = []

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function isPathWithin(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(basePath), resolve(candidatePath))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function getRepoIdFromPath(filePath: string, repos: { id: string; path: string }[]): string | null {
  let matchedRepo: { id: string; path: string } | null = null

  for (const repo of repos) {
    if (!isPathWithin(repo.path, filePath)) {
      continue
    }

    if (!matchedRepo || resolve(repo.path).length > resolve(matchedRepo.path).length) {
      matchedRepo = repo
    }
  }

  return matchedRepo?.id || null
}

function getCategoryFromPath(filePath: string): FileChangeEvent['category'] | null {
  const normalizedPath = toPosixPath(filePath)

  if (normalizedPath.includes('/docs/prd/') && normalizedPath.endsWith('.md')) {
    return 'prd'
  }

  return null
}

export async function initWatcher() {
  if (watcher) {
    startStateChangePolling()
    return
  }

  const repos = await getRepos()
  if (repos.length === 0) {
    watchedPaths = []
    stopStateChangePolling()
    return
  }

  // Build watch paths for PRD markdown updates.
  watchedPaths = repos.map((repo) => join(repo.path, 'docs', 'prd'))

  watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    persistent: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    },
    ignored: (path: string) => basename(path).startsWith('.'),
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

    emitChange({
      type: eventType,
      path: toPosixPath(filePath),
      repoId,
      category
    })
  })

  startStateChangePolling()

  console.log('[watcher] File watcher initialized, watching', watchedPaths.length, 'directories')
}

export async function refreshWatcher() {
  if (watcher) {
    await watcher.close()
    watcher = null
  }

  stopStateChangePolling()

  await initWatcher()
}

export function getWatcherStatus() {
  const statePolling = getStateChangePollingStatus()

  return {
    active: watcher !== null,
    watchedPaths,
    listenerCount: getChangeListenerCount(),
    statePollingActive: statePolling.active,
    statePollingIntervalMs: statePolling.intervalMs
  }
}
