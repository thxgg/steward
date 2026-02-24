import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { emitChange, getChangeListenerCount, type FileChangeEvent } from './change-events'
import { migrateLegacyStateForRepo } from './prd-state'
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
  for (const repo of repos) {
    if (isPathWithin(repo.path, filePath)) {
      return repo.id
    }
  }

  return null
}

function getCategoryFromPath(filePath: string): FileChangeEvent['category'] | null {
  const normalizedPath = toPosixPath(filePath)

  if (normalizedPath.includes('/docs/prd/') && normalizedPath.endsWith('.md')) {
    return 'prd'
  }

  // Legacy state files are still watched so they can be migrated into SQLite.
  if (normalizedPath.includes('/.claude/state/') && normalizedPath.endsWith('tasks.json')) {
    return 'tasks'
  }

  if (normalizedPath.includes('/.claude/state/') && normalizedPath.endsWith('progress.json')) {
    return 'progress'
  }

  return null
}

export async function initWatcher() {
  if (watcher) {
    return
  }

  const repos = await getRepos()
  if (repos.length === 0) {
    return
  }

  // Build watch paths - docs + legacy state path for migration triggers.
  watchedPaths = repos.flatMap((repo) => [
    join(repo.path, 'docs', 'prd'),
    join(repo.path, '.claude', 'state')
  ])

  watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    persistent: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    },
    // Allow legacy .claude directory (chokidar ignores dotfiles by default)
    ignored: (path: string) => {
      if (path.includes('.claude')) {
        return false
      }

      const fileName = basename(path)
      return fileName.startsWith('.') && fileName !== '.claude'
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
      const repo = repos.find((candidate) => candidate.id === repoId)
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

    emitChange({
      type: eventType,
      path: toPosixPath(filePath),
      repoId,
      category
    })
  })

  console.log('[watcher] File watcher initialized, watching', watchedPaths.length, 'directories')
}

export async function refreshWatcher() {
  if (watcher) {
    await watcher.close()
    watcher = null
  }

  await initWatcher()
}

export function getWatcherStatus() {
  return {
    active: watcher !== null,
    watchedPaths,
    listenerCount: getChangeListenerCount()
  }
}
