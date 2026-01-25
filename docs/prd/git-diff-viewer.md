# PRD: Git Diff Viewer

**Author:** Generated
**Date:** 2026-01-25
**Status:** Draft

## Problem Statement

When reviewing tasks in the PRD Viewer, there's no way to see the actual code changes associated with each completed task. Users currently have to manually cross-reference task completion times with git history, losing context about what was implemented.

### Current State

- Tasks track `filesChanged` in progress.json (list of filenames only)
- No git integration exists in the application
- Users must switch to terminal/IDE to view diffs
- No linkage between tasks and specific commits

### Impact

- Context switching between PRD viewer and git tools
- Difficulty reviewing what was actually implemented for each task
- Lost productivity when onboarding or reviewing others' work
- No audit trail of exact changes tied to tasks

## Users

### Primary Users
Developers and technical leads reviewing task implementations

### Secondary Users
- Team members onboarding to a codebase
- Code reviewers validating task completion
- Product managers verifying implementation matches requirements

### User Stories
- As a developer, I want to view the diff for a completed task so that I can understand what changed
- As a code reviewer, I want to see side-by-side comparisons of file changes so that I can review implementations efficiently
- As a team lead, I want to see which commits correspond to which tasks so that I can track work accurately

## Proposed Solution

### Overview

Add a git diff viewer integrated into the task detail panel. When viewing a completed task, users can see the commits associated with that task and view side-by-side diffs of changed files.

### Key Features

1. **Commit Annotation** - Automatically record commit SHAs when tasks are completed via `/complete-next-task` skill
2. **Task Commit List** - Display commits linked to a task in the task detail panel
3. **Side-by-Side Diff Viewer** - View file changes with syntax highlighting in a two-column layout
4. **File Change Summary** - Show list of changed files with additions/deletions counts
5. **Changes Minimap** - Visual overview showing all changed files with colored bars representing additions (green) and deletions (red) proportionally, allowing quick navigation to any file

### User Flow

1. User opens task detail panel for a completed task
2. Panel shows "Changes" section with list of commits
3. User clicks a commit to expand the diff viewer
4. Diff viewer shows:
   - **Minimap sidebar** (left) - Visual overview of all changed files with colored bars showing additions/deletions ratio
   - **Side-by-side diff** (main area) - Current file's changes with syntax highlighting
5. User clicks a file in the minimap to jump to that file's diff
6. User can navigate between files using minimap or keyboard shortcuts

## Scope

### In Scope

- Server-side git command execution for diff retrieval
- API endpoints for fetching commits and diffs
- Side-by-side diff viewer component with syntax highlighting
- Modification to `/complete-next-task` skill to capture commit SHAs
- Extension of task data model to store commit references
- Integration into existing task detail panel

### Out of Scope

- Inline/unified diff view (side-by-side only for v1)
- Commit creation or git write operations
- Branch management or git status display
- Diff viewing for uncommitted changes
- Cross-repository diff comparison
- GitHub/remote integration (local repos only)

### Future Considerations

- Unified diff view as alternative display mode
- Commit-level annotations/comments
- Integration with GitHub PR links
- Interactive diff staging

## Technical Considerations

### Affected Components

- `app/types/task.ts` - Add commit SHA fields to Task and TaskLog interfaces
- `app/components/tasks/Detail.vue` - Add "Changes" section with commit list
- `server/utils/git.ts` (new) - Git command execution utilities
- `server/api/repos/[repoId]/git/` (new) - Git-related API endpoints
- `.claude/skills/complete-next-task/skill.md` - Add commit capture step

### New Components Required

- `app/components/git/DiffViewer.vue` - Side-by-side diff display
- `app/components/git/FileChanges.vue` - List of changed files with stats
- `app/components/git/ChangesMinimap.vue` - Visual minimap showing all files with proportional add/delete bars
- `app/components/git/CommitList.vue` - List of commits for a task
- `app/composables/useGit.ts` - Git data fetching composable

### API Endpoints Required

```
GET /api/repos/[repoId]/git/commits?shas=sha1,sha2
GET /api/repos/[repoId]/git/diff?commit=sha
GET /api/repos/[repoId]/git/file-diff?commit=sha&file=path
```

### Data Model Extensions

```typescript
// In task.ts - extend TaskLog
interface TaskLog {
  // ... existing fields
  commits?: string[]  // Array of commit SHAs
}

// New git types
interface GitCommit {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  filesChanged: number
  additions: number
  deletions: number
}

interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string  // For renames
  additions: number
  deletions: number
}

interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldNumber?: number
  newNumber?: number
}
```

### Dependencies

- `simple-git` or native `child_process.spawn` for git operations
- Existing `shiki` for syntax highlighting in diff viewer

### Constraints

- Git must be installed on the host machine
- Repos must be valid git repositories
- Only works with configured repos (via repo selector)
- Large diffs may need pagination or truncation

## Success Criteria

### Metrics

- Users can view diffs for 100% of tasks with recorded commits
- Diff viewer loads in under 2 seconds for typical file sizes
- No git operations leak credentials or sensitive data

### Acceptance Criteria

- [ ] Completing a task via `/complete-next-task` prompts for or auto-detects commit SHA
- [ ] Task detail panel shows "Changes" section for tasks with commits
- [ ] Clicking a commit opens the diff viewer with minimap
- [ ] Minimap shows all changed files in a vertical list
- [ ] Each file in minimap displays a colored bar (green=additions, red=deletions) proportional to change volume
- [ ] Clicking a file in minimap scrolls/navigates to that file's diff
- [ ] Current file highlighted in minimap
- [ ] Side-by-side diff viewer shows syntax-highlighted code with line numbers
- [ ] Added lines highlighted in green, removed in red
- [ ] Context lines (unchanged) shown in neutral color
- [ ] Diff viewer scrolls synchronously between left/right panels
- [ ] Large files truncated with "Show more" option

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Git not installed | Low | High | Check git availability, show helpful error |
| Non-git repo selected | Medium | Medium | Gracefully disable git features for non-git repos |
| Large diffs slow UI | Medium | Medium | Paginate hunks, limit initial display |
| Path traversal attacks | Low | High | Validate paths within repo bounds |
| Binary files in diff | Medium | Low | Detect and show "Binary file" placeholder |

## Open Questions

- [ ] Should the skill prompt for commit SHA or attempt to auto-detect from recent commits?
- [ ] Maximum file size to display before truncation?
- [ ] Should we support viewing diffs for multiple commits at once (range diff)?

## Implementation Tasks

### Phase 1: Backend Foundation
1. Create git utility functions (spawn git commands, parse output)
2. Create API endpoints for commits and diffs
3. Add git type definitions

### Phase 2: Data Model & Skill Update
4. Extend TaskLog interface with commits field
5. Modify `/complete-next-task` to capture commit SHAs after committing

### Phase 3: Frontend Components
6. Create DiffViewer component with side-by-side layout
7. Create ChangesMinimap component with file list and proportional add/delete bars
8. Create FileChanges component for detailed file stats
9. Create CommitList component
10. Create useGit composable

### Phase 4: Integration
11. Add "Changes" section to TaskDetail component
12. Wire up data flow from API to components
13. Add loading and error states

### Phase 5: Polish
14. Add synchronized scrolling in diff viewer
15. Handle edge cases (binary files, large files, renames)
16. Add keyboard navigation for minimap and diff navigation

---

*Generated with /prd skill*
