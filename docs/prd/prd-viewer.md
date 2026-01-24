# PRD: PRD Viewer

**Author:** Generated
**Date:** 2026-01-24
**Status:** Draft

## Problem Statement

The prd, prd-task, and complete-next-task Claude Code skills generate structured PRD documents, task files, and progress tracking data across multiple repositories. Currently, there's no unified way to view and navigate this data - users must manually read JSON files and markdown documents scattered across `.claude/state/` and `docs/prd/` directories.

### Current State

- PRD markdown files live in `docs/prd/<feature-name>.md`
- Task definitions are in `.claude/state/<prd-name>/tasks.json`
- Progress tracking is in `.claude/state/<prd-name>/progress.json`
- Viewing requires opening files manually or using `cat`/editor
- No visual representation of task status or dependencies
- No way to see progress across multiple PRDs at once

### Impact

- Context switching: Must leave the terminal/IDE to review PRD content
- Mental overhead: Tracking task status requires parsing JSON mentally
- No birds-eye view: Can't quickly see what's blocked, in-progress, or done
- Multi-project friction: Checking status across repositories is tedious

## Users

### Primary Users

Individual developer using the prd/prd-task/complete-next-task skill workflow for personal projects.

### User Stories

- As a developer, I want to see all tasks for a PRD in a board view so I can quickly understand what's pending, in-progress, and completed
- As a developer, I want to read PRD documentation in a nicely formatted view so I can reference requirements without opening files
- As a developer, I want to switch between multiple repositories so I can track progress across different projects
- As a developer, I want the UI to match my system theme so it fits with my desktop environment

## Proposed Solution

### Overview

A Nuxt 4 web application with shadcn-vue components that provides a local dashboard for viewing PRD content and task progress. The app runs as a local dev server, with server-side API routes reading directly from configured repository paths.

### Key Features

1. **Repository Selector** - Account-style combobox in the header to switch between configured repositories or add new ones
2. **PRD Document Viewer** - Rendered markdown view of PRD files with navigation sidebar
3. **Task Board** - Kanban-style board showing tasks organized by status (pending/in-progress/completed)
4. **Repository Management** - Add, edit, remove repository paths stored in localStorage

### User Flow

1. User starts the app (`npm run dev`)
2. On first visit, prompted to add a repository path
3. App scans path for `docs/prd/*.md` and `.claude/state/*/tasks.json`
4. Sidebar shows list of PRDs found
5. Selecting a PRD shows the document view with a tab to switch to task board
6. Repository selector in header allows switching between configured repos

## Scope

### In Scope

- Repository path configuration with localStorage persistence
- PRD markdown rendering with syntax highlighting for code blocks
- Task board view with status columns (pending, in-progress, completed)
- Task detail view showing description, steps, passes criteria
- Real-time file watching for auto-refresh when files change
- System theme detection (light/dark mode)
- Responsive layout for different screen sizes

### Out of Scope

- Task editing (read-only viewer)
- Running complete-next-task from the UI
- Multi-user collaboration features
- Cloud sync or remote access
- Mobile app
- Dependency graph visualization (future consideration)
- Progress charts/statistics (future consideration)

### Future Considerations

- Visual dependency graph showing task relationships
- Progress dashboard with completion charts
- Search across all PRDs and tasks
- Keyboard shortcuts for navigation
- Export/print PRD views

## Technical Considerations

### Architecture

```
prd-viewer/
├── app/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── RepoSelector.vue      # Header repo combobox
│   │   │   └── Sidebar.vue           # PRD list navigation
│   │   ├── prd/
│   │   │   ├── PrdViewer.vue         # Markdown renderer
│   │   │   └── PrdMeta.vue           # PRD metadata display
│   │   └── tasks/
│   │       ├── TaskBoard.vue         # Kanban board
│   │       ├── TaskColumn.vue        # Status column
│   │       ├── TaskCard.vue          # Individual task card
│   │       └── TaskDetail.vue        # Task detail panel
│   ├── pages/
│   │   ├── index.vue                 # Landing/repo setup
│   │   └── [repo]/
│   │       └── [prd].vue             # PRD view with tabs
│   └── layouts/
│       └── default.vue               # Header + sidebar layout
├── server/
│   └── api/
│       ├── repos/
│       │   ├── index.get.ts          # List configured repos
│       │   ├── index.post.ts         # Add repo
│       │   └── [id].delete.ts        # Remove repo
│       └── [repo]/
│           ├── prds.get.ts           # List PRDs in repo
│           └── [prd]/
│               ├── document.get.ts   # Get PRD markdown
│               ├── tasks.get.ts      # Get tasks.json
│               └── progress.get.ts   # Get progress.json
├── composables/
│   ├── useRepos.ts                   # Repository management
│   └── usePrd.ts                     # PRD data fetching
└── types/
    ├── repo.ts                       # Repository config types
    ├── prd.ts                        # PRD document types
    └── task.ts                       # Task/progress types
```

### Data Flow

```
localStorage (repo configs)
    ↓
Server API routes (read filesystem)
    ↓
Nuxt data fetching (useFetch/useAsyncData)
    ↓
Vue components (render UI)
```

### Dependencies

- **Nuxt 4** - Framework with file-based routing and server API
- **shadcn-vue** - UI component library
- **@nuxt/content** or **marked** - Markdown parsing and rendering
- **shiki** - Syntax highlighting for code blocks
- **chokidar** - File watching for auto-refresh (server-side)
- **Tailwind CSS v4** - Styling (comes with shadcn-vue)

### Data Schemas

**Repository Config (localStorage)**
```typescript
interface RepoConfig {
  id: string;           // UUID
  name: string;         // Display name
  path: string;         // Absolute filesystem path
  addedAt: string;      // ISO timestamp
}
```

**PRD List Response**
```typescript
interface PrdListItem {
  slug: string;         // URL-safe identifier
  name: string;         // PRD title from markdown
  source: string;       // Relative path to .md file
  hasState: boolean;    // Whether .claude/state/<slug> exists
  taskCount?: number;   // Total tasks if state exists
  completedCount?: number;
}
```

**Task (from tasks.json)**
```typescript
interface Task {
  id: string;
  category: 'setup' | 'feature' | 'integration' | 'testing' | 'documentation';
  title: string;
  description: string;
  steps: string[];
  passes: string[];
  dependencies: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: string;
  completedAt?: string;
}
```

### Constraints

- Must work with existing skill output format (no changes to prd/prd-task skills)
- Server must validate paths exist before reading
- Handle missing files gracefully (PRD without tasks, etc.)
- File paths should be sanitized to prevent directory traversal

## Success Criteria

### Metrics

- Can view any PRD markdown in formatted view
- Can see task status at a glance in board view
- Can switch between repos in under 2 seconds
- UI responds to system theme changes

### Acceptance Criteria

- [ ] Repository selector allows adding paths via text input
- [ ] Repository selector shows all configured repos with ability to switch
- [ ] Sidebar lists all PRDs found in `docs/prd/` directory
- [ ] PRD viewer renders markdown with proper formatting
- [ ] PRD viewer shows metadata (author, date, status, shortcut link if present)
- [ ] Task board shows three columns: Pending, In Progress, Completed
- [ ] Task cards show title, category badge, and priority indicator
- [ ] Clicking a task card shows full details (description, steps, passes)
- [ ] Task dependencies are indicated (blocked by X tasks)
- [ ] Theme follows system preference (dark/light)
- [ ] Missing files show helpful empty states, not errors
- [ ] Page auto-refreshes when underlying files change

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Filesystem access errors | Medium | Medium | Validate paths on add, show clear error messages |
| Large repos slow to scan | Low | Low | Only scan known directories, not recursive |
| PRD format variations | Medium | Low | Parse defensively, show raw content as fallback |
| File watching resource usage | Low | Medium | Debounce refreshes, watch specific directories only |

## Open Questions

- [ ] Should deleted repos be soft-deleted (hidden) or hard-deleted from localStorage?
- [ ] Should there be a "recent PRDs" quick-access list?
- [ ] What should happen if a repo path becomes invalid (moved/deleted)?

## Implementation Notes

### shadcn-vue Components to Use

- **Combobox** - Repository selector
- **Card** - Task cards, PRD metadata
- **Badge** - Category and priority indicators
- **Tabs** - Document/Board view toggle
- **Sheet** - Task detail panel (slide-in from right)
- **Separator** - Visual dividers
- **ScrollArea** - Scrollable task columns

### Markdown Rendering

Use `@nuxt/content` or `marked` + `shiki` for rendering PRD markdown:
- GitHub-flavored markdown support
- Syntax highlighting for code blocks
- Table rendering for risks matrix
- Checkbox rendering for acceptance criteria

### File Watching Strategy

Use chokidar on the server to watch:
- `<repo>/docs/prd/*.md`
- `<repo>/.claude/state/*/tasks.json`
- `<repo>/.claude/state/*/progress.json`

Send SSE or WebSocket events to connected clients for real-time updates.

---

*Generated with /prd skill*
