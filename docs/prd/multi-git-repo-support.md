# PRD: Multi-Git Repository Support for Pseudo-Monorepos

**Author:** Generated
**Date:** 2026-01-25
**Status:** Draft

## Problem Statement

The PRD viewer cannot display commit diffs for repositories that use a "pseudo-monorepo" structure, where the PRD files and `.claude/state/` live at a parent directory level, but the actual git repositories are in subfolders.

### Current State

1. User registers a repo path (e.g., `/Projects/Work/code-hospitality-monorepo`)
2. The path is validated for having `docs/prd` or `.claude` directory
3. When viewing task commits, the viewer runs git commands against the registered path
4. Git commands fail silently because there's no `.git` at the registered path - the git repos are in subfolders like `code-hospitality-backend/.git`, `code-hospitality-cms-vue/.git`, etc.

The viewer currently assumes 1:1 relationship between registered repo path and git repository location.

### Impact

- **Broken functionality**: Diff viewer shows nothing for pseudo-monorepo projects
- **Confusion**: Users see tasks with commits logged, but cannot view the actual changes
- **Workaround required**: Would need to register each subfolder separately, losing the unified PRD view

## Users

### Primary Users

Developers working with pseudo-monorepos where:
- Multiple related projects share a parent directory
- Each project has its own git repository
- PRD files and state are managed at the parent level

### User Stories

- As a developer with a pseudo-monorepo, I want to view commit diffs for tasks even when the commits are in subfolder git repos
- As a developer, I want the viewer to auto-discover git repos so I don't have to configure each one manually
- As a developer viewing a task, I want to see which repo each commit belongs to so I understand the context

## Proposed Solution

### Overview

Store repository context alongside commit SHAs in progress.json for O(1) lookup. Auto-discover git repositories in subfolders to enable the `/complete-next-task` skill to record which repo each commit belongs to. Fall back to searching discovered repos for legacy data that lacks repo info.

### Key Features

1. **Commit-Repo Linking** - Store repo name with each commit SHA in progress.json for instant lookup
2. **Git Repo Auto-Discovery** - When a repo is registered, scan for `.git` directories in subfolders (depth 1-2)
3. **Backwards-Compatible Schema** - Support both legacy `string[]` and new `CommitRef[]` formats
4. **Search Fallback** - For legacy commits without repo info, search discovered git repos
5. **Repo Context in UI** - Display which subfolder/repo a commit belongs to in the task details

### User Flow

**Adding a pseudo-monorepo:**
1. User adds repo path `/Projects/Work/code-hospitality-monorepo`
2. Backend validates path has `docs/prd` or `.claude`
3. Backend discovers git repos: `code-hospitality-backend`, `code-hospitality-cms-vue`, etc.
4. Backend stores discovered repos in `RepoConfig.gitRepos[]`

**Viewing task commits:**
1. User clicks task to view details
2. Frontend fetches commits for task (existing flow)
3. Backend reads progress.json - commits now include repo info
4. For legacy commits (string-only), backend searches discovered git repos as fallback
5. Backend returns commit info with repo context
6. Frontend displays commits grouped by task with repo indicator

**Recording commits (via `/complete-next-task` skill):**
1. Skill completes work and creates commit in a subfolder repo
2. Skill determines current git repo relative to registered path
3. Skill writes commit as `{ sha, repo }` object to progress.json
4. Repo info is preserved for instant lookup later

## Scope

### In Scope

- Store repo context with commits in progress.json (`{ sha, repo }` format)
- Backwards-compatible schema supporting both string and object commit formats
- Discover git repos in subfolders (max depth 2) when registering a repo
- Store discovered git repo paths in RepoConfig
- Search discovered repos as fallback for legacy commits
- Return repo context (subfolder name) with commit/diff responses
- Display repo indicator in UI for commits
- Update `/complete-next-task` skill to record repo with commits

### Out of Scope

- Nested git submodules
- Git worktrees
- Remote repository discovery
- Cross-repo commit relationships
- Automatic sync/re-discovery on filesystem changes
- Migration tool for existing progress.json files (fallback handles this)

### Future Considerations

- Manual git repo configuration for edge cases
- Support for deeper nesting (depth > 2)
- Re-scan button in UI to discover newly added git repos

## Technical Considerations

### Affected Components

| File | Changes |
|------|---------|
| `app/types/task.ts` | Add `CommitRef` type, update `TaskLog.commits` to union type |
| `app/types/repo.ts` | Add `gitRepos` field to `RepoConfig`, add `GitRepoInfo` type |
| `app/types/git.ts` | Add `repoPath` field to `GitCommit` type |
| `server/utils/repos.ts` | Add `discoverGitRepos()` function, update `addRepo()` to call it |
| `server/utils/git.ts` | Add `findRepoForCommit()` to search multiple repos, add `resolveCommitRepo()` helper |
| `server/api/repos/[repoId]/git/diff.get.ts` | Accept repo path in query, use correct git repo |
| `server/api/repos/[repoId]/git/commits.get.ts` | Parse `CommitRef` objects, return repo context |
| `server/api/repos/[repoId]/git/file-diff.get.ts` | Accept repo path in query |
| `server/api/repos/[repoId]/git/file-content.get.ts` | Accept repo path in query |
| `server/api/repos/[repoId]/prd/[prdSlug]/tasks/[taskId]/commits.get.ts` | Return normalized `CommitRef[]` |
| `app/composables/useGit.ts` | Pass repo path to API calls |
| `app/components/tasks/TaskDetail.vue` | Display repo indicator on commits |
| `~/.claude/skills/complete-next-task/*` | Record repo with commit SHAs |

### Data Model Changes

**Progress file schema (app/types/task.ts):**
```typescript
// New type for commit with repo context
export interface CommitRef {
  /** Git commit SHA */
  sha: string
  /** Relative path to git repo (e.g., "code-hospitality-backend") */
  repo: string
}

export interface TaskLog {
  // ... existing fields ...

  /** Git commits - supports both legacy strings and new CommitRef objects */
  commits?: (string | CommitRef)[]
}
```

**Repository config (app/types/repo.ts):**
```typescript
export interface RepoConfig {
  id: string
  name: string
  path: string
  addedAt: string
  // New field for discovered git repos
  gitRepos?: GitRepoInfo[]
}

export interface GitRepoInfo {
  /** Relative path from repo root (e.g., "code-hospitality-backend") */
  relativePath: string
  /** Absolute path to the git repo */
  absolutePath: string
  /** Display name (usually folder name) */
  name: string
}
```

**Example progress.json with new format:**
```json
{
  "taskLogs": [
    {
      "taskId": "task-001",
      "commits": [
        { "sha": "1665d978...", "repo": "code-hospitality-backend" },
        { "sha": "2e19c43c...", "repo": "code-hospitality-cms-vue" }
      ]
    },
    {
      "taskId": "task-002",
      "commits": ["abc123"]  // Legacy format still supported
    }
  ]
}
```

### API Changes

**GET `/api/repos/:repoId/git/commits`**

Current response:
```json
{ "sha": "abc123", "message": "...", ... }
```

New response:
```json
{ "sha": "abc123", "message": "...", "repoPath": "code-hospitality-backend", ... }
```

### Algorithm for Commit Resolution

```
resolveCommitRepo(repoConfig, commitEntry):
  1. If commitEntry is object with { sha, repo }:
     - Return { sha, repoPath: join(repoConfig.path, repo) }  // O(1)

  2. If commitEntry is string (legacy):
     - Call findRepoForCommit(repoConfig, sha)  // O(n) fallback

findRepoForCommit(repoConfig, sha):
  1. If repoConfig.path is git repo, check if sha exists there
  2. Get list of discovered gitRepos from repoConfig
  3. For each gitRepo in parallel:
     - Run `git cat-file -t {sha}` to check if commit exists
  4. Return first gitRepo where commit is found
  5. Throw error if commit not found in any repo
```

### Performance Considerations

- **New commits**: O(1) lookup via stored repo info in progress.json
- **Legacy commits**: O(n) parallel git checks (n = discovered repos)
- Git repo discovery only happens at registration time
- No caching needed since repo info is persisted with commits

## Success Criteria

### Metrics

- Diff viewer works for 100% of commits from pseudo-monorepo tasks
- No regression in performance for standard (single git repo) setups

### Acceptance Criteria

- [ ] Adding a pseudo-monorepo auto-discovers git repos in subfolders
- [ ] Viewing task commits shows diffs from the correct subfolder repo
- [ ] UI indicates which repo each commit comes from
- [ ] Standard repos (git at root) continue to work unchanged
- [ ] Legacy commits (string-only) resolve via search fallback
- [ ] New commits from `/complete-next-task` include repo info
- [ ] Error message when commit not found in any discovered repo

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Skill not updated, commits lack repo info | Medium | Low | Search fallback handles gracefully |
| Discovery misses deeply nested repos | Low | Low | Document depth limit, allow future config |
| Commit SHA collision across repos | Very Low | Medium | Unlikely with SHA-1/SHA-256, return first match |
| Legacy progress.json files | Certain | Low | Backwards-compatible schema, search fallback |

## Open Questions

- [ ] Should we support manually specifying git repo paths for edge cases?
- [ ] What's the maximum depth for auto-discovery? (Currently proposed: 2)

## Implementation Order

1. Update types (`CommitRef`, `TaskLog`, `RepoConfig`, `GitRepoInfo`, `GitCommit`)
2. Add `discoverGitRepos()` utility function
3. Update `addRepo()` to call discovery and store results in repos.json
4. Add `resolveCommitRepo()` and `findRepoForCommit()` utilities
5. Update commits API to return normalized `CommitRef[]` with repo context
6. Update git diff/content APIs to accept repo path parameter
7. Update frontend composables and components to pass/display repo context
8. Update `/complete-next-task` skill to record repo with commits
9. Add re-scan functionality for discovering new git repos

---

*Generated with /prd skill*
