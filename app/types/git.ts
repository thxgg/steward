/**
 * Git commit information
 */
export interface GitCommit {
  /** Full commit SHA */
  sha: string
  /** Short commit SHA (7 characters) */
  shortSha: string
  /** Commit message (first line) */
  message: string
  /** Author name */
  author: string
  /** Commit date as ISO string */
  date: string
  /** Number of files changed */
  filesChanged: number
  /** Total lines added */
  additions: number
  /** Total lines deleted */
  deletions: number
}

/**
 * File change status in a commit
 */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/**
 * File diff summary within a commit
 */
export interface FileDiff {
  /** Current file path */
  path: string
  /** Change status */
  status: FileStatus
  /** Original file path (for renames) */
  oldPath?: string
  /** Lines added in this file */
  additions: number
  /** Lines deleted in this file */
  deletions: number
}

/**
 * Type of diff line
 */
export type DiffLineType = 'add' | 'remove' | 'context'

/**
 * Single line in a diff hunk
 */
export interface DiffLine {
  /** Line type: addition, removal, or context */
  type: DiffLineType
  /** Line content (without +/- prefix) */
  content: string
  /** Line number in old file (for remove/context lines) */
  oldNumber?: number
  /** Line number in new file (for add/context lines) */
  newNumber?: number
}

/**
 * A hunk (section) of a diff
 */
export interface DiffHunk {
  /** Starting line in old file */
  oldStart: number
  /** Number of lines from old file */
  oldLines: number
  /** Starting line in new file */
  newStart: number
  /** Number of lines in new file */
  newLines: number
  /** Lines in this hunk */
  lines: DiffLine[]
}
