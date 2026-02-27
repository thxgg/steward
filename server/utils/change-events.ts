import { dbAll } from './db.js'

export type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink'
  path: string
  repoId: string
  category: 'prd' | 'tasks' | 'progress'
}

type Listener = (event: FileChangeEvent) => void

type PrdStateRevisionRow = {
  repo_id: string
  slug: string
  updated_at: string
}

const listeners = new Set<Listener>()
const pendingEvents: FileChangeEvent[] = []

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let stateChangePollTimer: ReturnType<typeof setInterval> | null = null
let stateChangePollInFlight = false
let hasSeededStateSnapshot = false

const lastStateSnapshot = new Map<string, string>()

const DEBOUNCE_MS = 300
const STATE_CHANGE_POLL_INTERVAL_MS = 1000

function toStateSnapshotKey(repoId: string, slug: string): string {
  return `${repoId}:${slug}`
}

function fromStateSnapshotKey(key: string): { repoId: string; slug: string } | null {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null
  }

  return {
    repoId: key.slice(0, separatorIndex),
    slug: key.slice(separatorIndex + 1)
  }
}

function emitStateRowChange(repoId: string, slug: string): void {
  emitChange({
    type: 'change',
    path: `state://${repoId}/${slug}/tasks.json`,
    repoId,
    category: 'tasks'
  })

  emitChange({
    type: 'change',
    path: `state://${repoId}/${slug}/progress.json`,
    repoId,
    category: 'progress'
  })
}

async function pollPrdStateChanges(): Promise<void> {
  if (stateChangePollInFlight) {
    return
  }

  stateChangePollInFlight = true

  try {
    const rows = await dbAll<PrdStateRevisionRow>(
      `
        SELECT repo_id, slug, updated_at
        FROM prd_states
        ORDER BY repo_id ASC, slug ASC
      `
    )

    const nextSnapshot = new Map<string, string>()
    const changedRows: { repoId: string; slug: string }[] = []

    for (const row of rows) {
      const key = toStateSnapshotKey(row.repo_id, row.slug)
      nextSnapshot.set(key, row.updated_at)

      if (!hasSeededStateSnapshot) {
        continue
      }

      const previousUpdatedAt = lastStateSnapshot.get(key)
      if (previousUpdatedAt === undefined || previousUpdatedAt !== row.updated_at) {
        changedRows.push({ repoId: row.repo_id, slug: row.slug })
      }
    }

    if (hasSeededStateSnapshot) {
      for (const key of lastStateSnapshot.keys()) {
        if (nextSnapshot.has(key)) {
          continue
        }

        const parsed = fromStateSnapshotKey(key)
        if (parsed) {
          changedRows.push(parsed)
        }
      }
    }

    lastStateSnapshot.clear()
    for (const [key, updatedAt] of nextSnapshot.entries()) {
      lastStateSnapshot.set(key, updatedAt)
    }

    if (!hasSeededStateSnapshot) {
      hasSeededStateSnapshot = true
      return
    }

    for (const row of changedRows) {
      emitStateRowChange(row.repoId, row.slug)
    }
  } catch {
    // Ignore transient polling failures.
  } finally {
    stateChangePollInFlight = false
  }
}

export function startStateChangePolling(): void {
  if (listeners.size === 0 || stateChangePollTimer) {
    return
  }

  void pollPrdStateChanges()

  stateChangePollTimer = setInterval(() => {
    void pollPrdStateChanges()
  }, STATE_CHANGE_POLL_INTERVAL_MS)
}

export function stopStateChangePolling(): void {
  if (stateChangePollTimer) {
    clearInterval(stateChangePollTimer)
    stateChangePollTimer = null
  }

  stateChangePollInFlight = false
  hasSeededStateSnapshot = false
  lastStateSnapshot.clear()
}

export function getStateChangePollingStatus(): { active: boolean; intervalMs: number } {
  return {
    active: stateChangePollTimer !== null,
    intervalMs: STATE_CHANGE_POLL_INTERVAL_MS
  }
}

function flushPendingEvents() {
  const dedupedEvents = new Map<string, FileChangeEvent>()
  for (const event of pendingEvents) {
    dedupedEvents.set(`${event.repoId}:${event.category}:${event.path}`, event)
  }

  pendingEvents.length = 0
  debounceTimer = null

  for (const event of dedupedEvents.values()) {
    for (const listener of listeners) {
      listener(event)
    }
  }
}

export function emitChange(event: FileChangeEvent): void {
  pendingEvents.push(event)

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(flushPendingEvents, DEBOUNCE_MS)
}

export function addChangeListener(listener: Listener): () => void {
  listeners.add(listener)

  if (listeners.size === 1) {
    startStateChangePolling()
  }

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      stopStateChangePolling()
    }
  }
}

export function getChangeListenerCount(): number {
  return listeners.size
}
