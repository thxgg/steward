# PRD Viewer

PRD Viewer is a local-first Nuxt app for browsing Product Requirements Documents and tracking implementation state in a global SQLite database.

This project is intended to be downloaded and run locally on your machine. It is not designed for public internet deployment.

## What It Does

- Scans repositories for `docs/prd/*.md` files and displays them in a focused UI.
- Reads task state (`tasks.json` and `progress.json`) from a global SQLite database.
- Supports legacy `.claude/state/*` migration into the global database.
- Resolves commit references for tasks, including pseudo-monorepo sub-repo contexts.

## Local-First Security Model

PRD Viewer exposes local filesystem and git metadata for convenience. Because of that:

- Run it only on trusted local machines.
- Do not expose it directly to the public internet.
- Treat it as a developer workstation tool, not a hosted multi-user service.

## Requirements

- Bun (project package manager/runtime)
- Git
- Linux/macOS (or compatible environment)

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000`, then add a local repository path that contains a `docs/prd/` directory.

## Scripts

- `bun run dev` - Start local dev server
- `bun run typecheck` - Run Nuxt type checking
- `bun run build` - Build production bundle
- `bun run preview` - Preview the production build locally

## Global PRD State Storage

PRD state is system-global and stored in SQLite:

- Default: `${XDG_DATA_HOME:-~/.local/share}/prd/state.db`
- Override full path: `PRD_STATE_DB_PATH`
- Override base dir: `PRD_STATE_HOME` (resolved to `<PRD_STATE_HOME>/state.db`)

This allows multiple local repos to share one PRD state store.

## Environment Variables

Copy `.env.example` to `.env` if you want to override defaults.

| Variable | Required | Description |
| --- | --- | --- |
| `PRD_STATE_DB_PATH` | No | Absolute path to SQLite database file |
| `PRD_STATE_HOME` | No | Directory used for database home (`state.db` inside it) |
| `XDG_DATA_HOME` | No | Used for default global state location |

## OpenCode Bundle Included

This repository includes a curated OpenCode bundle under `opencode/`:

- Commands: `prd`, `prd-task`, `complete-next-task`, `commit`
- Skills: `prd`, `prd-task`, `complete-next-task`, `commit`
- Script: `prd-db.ts`

`frontend-design` is intentionally not included.

To install into a local OpenCode config:

```bash
mkdir -p ~/.config/opencode
cp -R opencode/commands ~/.config/opencode/
cp -R opencode/skills ~/.config/opencode/
cp -R opencode/scripts ~/.config/opencode/
```

## CI

GitHub Actions runs:

- Typecheck + build validation
- Secret scanning with gitleaks

## Roadmap

- Continue hardening local-only workflows
- Evolve PRD Viewer into a local MCP-friendly toolchain
