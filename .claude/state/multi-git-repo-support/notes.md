# Multi-Git Repository Support - Implementation Notes

## Key Decisions

- **Commit-repo linking stored in progress.json** - O(1) lookup vs O(n) search
- **Backwards-compatible schema** - Supports both `string[]` and `CommitRef[]`
- **Auto-discovery** - Scans up to depth 2 for .git directories
- **Search fallback** - Legacy commits resolved by searching discovered repos

## Architecture

```
progress.json commits:
  - New: { "sha": "abc123", "repo": "code-hospitality-backend" }
  - Legacy: "abc123" (resolved via search)

RepoConfig.gitRepos[]:
  - Populated at registration time
  - Used for fallback search and validation
```

## Files to Modify

### Types (task-001)
- `app/types/task.ts` - CommitRef type
- `app/types/repo.ts` - GitRepoInfo type
- `app/types/git.ts` - GitCommit.repoPath

### Server Utils (task-002, task-004)
- `server/utils/repos.ts` - discoverGitRepos()
- `server/utils/git.ts` - resolveCommitRepo(), findRepoForCommit()

### APIs (task-005 through task-008)
- `server/api/repos/[repoId]/prd/[prdSlug]/tasks/[taskId]/commits.get.ts`
- `server/api/repos/[repoId]/git/diff.get.ts`
- `server/api/repos/[repoId]/git/file-diff.get.ts`
- `server/api/repos/[repoId]/git/file-content.get.ts`
- `server/api/repos/[repoId]/git/commits.get.ts`

### Frontend (task-009 through task-011)
- `app/composables/useGit.ts`
- `app/components/tasks/TaskDetail.vue`
- `app/components/git/DiffPanel.vue`

### Skill (task-012)
- `~/.claude/skills/complete-next-task/*`

## Testing Notes

Test with `/Users/thxgg/Projects/Work/code-hospitality-monorepo`:
- Has `.claude/state/` at root
- Git repos in: `code-hospitality-backend`, `code-hospitality-cms-vue`, `code-hospitality-cms`, `code-hospitality-web`, `code-hospitality-mobile`
- Existing PRDs with commits to test legacy fallback
