/**
 * Repository configuration stored server-side
 */
export interface RepoConfig {
  /** Unique identifier (UUID) */
  id: string
  /** Display name for the repository */
  name: string
  /** Absolute filesystem path to the repository */
  path: string
  /** ISO timestamp when the repo was added */
  addedAt: string
}

/**
 * Request body for adding a new repository
 */
export interface AddRepoRequest {
  /** Absolute filesystem path to the repository */
  path: string
  /** Optional display name (defaults to directory name) */
  name?: string
}
