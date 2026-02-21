# Steward

A Nuxt web application for viewing PRD documents and tracking task progress.

## Tech Stack

- Nuxt 3 (compatibility v4)
- shadcn-vue
- Tailwind CSS v4
- TypeScript

## Package Manager

This project uses **npm** (with pnpm-compatible scripts).

- `npm install` - Install dependencies
- `npm run dev` - Start dev server
- `npm run build` - Build for production

## Development Guidelines

### Project Structure

```
app/
├── components/
│   ├── layout/      # RepoSelector, Sidebar
│   ├── prd/         # PrdViewer, PrdMeta
│   └── tasks/       # TaskBoard, TaskCard, TaskDetail
├── pages/
├── layouts/
├── composables/
└── types/
server/
└── api/
```

## State Storage

PRD task state is centralized in a local SQLite database:
- Default path: `${XDG_DATA_HOME:-~/.local/share}/prd/state.db`
- Optional override: `PRD_STATE_DB_PATH`

Legacy `.claude/state/*` files are treated as migration input only.

## Commands

- `/complete-next-task prd-viewer` - Complete the next task from the PRD
