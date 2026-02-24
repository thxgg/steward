export type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink'
  path: string
  repoId: string
  category: 'prd' | 'tasks' | 'progress'
}

type Listener = (event: FileChangeEvent) => void

const listeners = new Set<Listener>()
const pendingEvents: FileChangeEvent[] = []

let debounceTimer: ReturnType<typeof setTimeout> | null = null

const DEBOUNCE_MS = 300

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

  return () => {
    listeners.delete(listener)
  }
}

export function getChangeListenerCount(): number {
  return listeners.size
}
