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

## Release Process

When doing a release (`commit`, `tag`, `push`, `release`), follow this exact order.

1. Confirm a clean tree and synced branch:
   - `git status`
2. Bump package version first (must happen before tagging):
   - `npm version <x.y.z> --no-git-tag-version`
   - This updates both `package.json` and `package-lock.json`
3. Validate before release:
   - `npm run typecheck`
4. Commit the release bump:
   - Example: `git commit -am "chore(release): bump v<x.y.z>"`
5. Push commit to `main`:
   - `git push origin main`
6. Create and push matching annotated tag:
   - `git tag -a v<x.y.z> -m "v<x.y.z>"`
   - `git push origin v<x.y.z>`
7. Create GitHub release from the tag:
   - `gh release create v<x.y.z> --title "v<x.y.z>" --generate-notes`
8. Verify publish completed:
   - `gh run list --workflow Publish --limit 5`
   - `npm view @thxgg/steward version`

Critical rule: The git tag version and `package.json` version must match, and the version must not already exist on npm.
