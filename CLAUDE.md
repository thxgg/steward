# PRD Viewer

A Nuxt 4 web application for viewing PRD documents and tracking task progress.

## Tech Stack

- Nuxt 4
- shadcn-vue
- Tailwind CSS v4
- TypeScript

## Package Manager

This project uses **bun**.

- `bun install` - Install dependencies
- `bun run dev` - Start dev server
- `bun run build` - Build for production

## Development Guidelines

### Frontend Design

When implementing UI components or pages, use the `/frontend-design` skill to ensure:
- Distinctive, non-generic visual design
- Production-grade Vue/Nuxt patterns
- Proper use of shadcn-vue components
- Vue transitions and micro-interactions
- Intentional design direction (not default AI aesthetics)

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

## State Files

PRD and task state is tracked in `.claude/state/prd-viewer/`:
- `tasks.json` - Task definitions and status
- `progress.json` - Progress tracking
- `notes.md` - Implementation decisions

## Commands

- `/frontend-design` - Use for any UI/component work
- `/complete-next-task prd-viewer` - Complete the next task from the PRD
