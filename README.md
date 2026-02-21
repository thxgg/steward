# Steward

Local-first PRD workflow steward for AI agents and developers.
Nuxt UI + codemode MCP + SQLite state store.

- npm package: `@thxgg/steward`
- CLI command: `prd`

## Install

### Via npm

```bash
npm install -g @thxgg/steward
```

### Without global install

```bash
npx -y @thxgg/steward ui
```

## Usage

### MCP Server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "prd": {
      "command": "npx",
      "args": ["-y", "@thxgg/steward", "mcp"]
    }
  }
}
```

### CLI

```bash
prd ui
prd ui --preview
prd ui --port 3100 --host 127.0.0.1
prd mcp
```

## Architecture

```
┌─────────────────────────────────────────┐
│            Steward CLI (Node)           │
│  - `prd ui` launches Nuxt app           │
│  - `prd mcp` starts MCP over stdio      │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│         Codemode MCP (`execute`)        │
│  - VM sandbox                           │
│  - APIs: repos, prds, git, state        │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│         Local SQLite PRD State          │
│  - Global store shared across repos     │
└─────────────────────────────────────────┘
```

## Codemode Pattern

Steward exposes one MCP tool: `execute`.

```js
const reposList = await repos.list()
const repo = reposList[0]
if (!repo) return { error: 'No repos configured' }

const prdList = await prds.list(repo.id)
if (prdList.length === 0) return { repo: repo.name, prds: 0 }

const slug = prdList[0].slug
return {
  doc: await prds.getDocument(repo.id, slug),
  tasks: await prds.getTasks(repo.id, slug),
  progress: await prds.getProgress(repo.id, slug)
}
```

## APIs

Inside `execute`, these APIs are available:

- `repos` - register/list/remove repos and refresh discovered git repos
- `prds` - list/read PRD docs, tasks, progress, and task commit refs
- `git` - commit metadata, diffs, file diffs, and file contents
- `state` - direct PRD state get/upsert by repo id or path

Detailed API docs and examples: `docs/MCP.md`

## Local-First Security Model

Steward reads local filesystem and git metadata by design.

- Run only on trusted local machines
- Do not expose directly to the public internet
- Treat as a workstation tool, not a hosted multi-user service

## Storage

PRD state is stored in SQLite at:

1. `PRD_STATE_DB_PATH` (if set)
2. `PRD_STATE_HOME/state.db` (if set)
3. `${XDG_DATA_HOME:-~/.local/share}/prd/state.db`

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `PRD_STATE_DB_PATH` | Absolute path to SQLite DB file |
| `PRD_STATE_HOME` | Base directory for DB (`state.db` inside) |
| `XDG_DATA_HOME` | Fallback base path for default DB location |

## OpenCode Bundle

This repo includes curated OpenCode assets under `opencode/`:

- Commands: `prd`, `prd-task`, `complete-next-task`, `commit`
- Skills: `prd`, `prd-task`, `complete-next-task`, `commit`
- Script: `prd-db.mjs`

## License

MIT
