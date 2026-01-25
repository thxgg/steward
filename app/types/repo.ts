/**
 * Information about a discovered git repository within a pseudo-monorepo
 */
export interface GitRepoInfo {
  /** Relative path from registered repo root (e.g., "code-hospitality-backend") */
  relativePath: string
  /** Absolute filesystem path to the git repo */
  absolutePath: string
  /** Display name (usually folder name) */
  name: string
}

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
  /** Discovered git repositories for pseudo-monorepos (empty/undefined for standard repos) */
  gitRepos?: GitRepoInfo[]
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
