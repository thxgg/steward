/**
 * PRD list item returned when listing PRDs in a repository
 */
export interface PrdArchiveState {
  /** Whether this PRD is archived */
  archived: boolean
  /** ISO timestamp when this PRD was archived */
  archivedAt?: string
}

export interface PrdListItem {
  /** URL-safe identifier (derived from filename) */
  slug: string
  /** PRD title extracted from markdown H1 */
  name: string
  /** Relative path to the .md file */
  source: string
  /** Whether tracked task/progress state exists for this PRD */
  hasState: boolean
  /** Total number of tasks if state exists */
  taskCount?: number
  /** Number of completed tasks if state exists */
  completedCount?: number
  /** File modification timestamp (ms since epoch) */
  modifiedAt: number
  /** Archive visibility state */
  archived: boolean
  /** ISO timestamp when this PRD was archived */
  archivedAt?: string
}

/**
 * PRD metadata extracted from document header
 */
export interface PrdMetadata {
  /** Document author */
  author?: string
  /** Creation/update date */
  date?: string
  /** Document status (Draft, In Progress, Complete, etc.) */
  status?: string
  /** Shortcut story ID if linked */
  shortcutStory?: string
  /** Shortcut story URL if linked */
  shortcutUrl?: string
}

/**
 * Full PRD document with content and metadata
 */
export interface PrdDocument {
  /** URL-safe identifier */
  slug: string
  /** PRD title */
  name: string
  /** Raw markdown content */
  content: string
  /** Extracted metadata */
  metadata: PrdMetadata
  /** Archive visibility state */
  archived: boolean
  /** ISO timestamp when this PRD was archived */
  archivedAt?: string
}
