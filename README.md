# Steward

Local-first PRD workflow steward for AI agents and developers.
Nuxt UI + codemode MCP + SQLite state store.

- npm package: `@thxgg/steward`
- CLI command: `prd`

## Acknowledgments

Steward is heavily inspired by work from [dmmulroy](https://github.com/dmmulroy), including the similar project [Overseer](https://github.com/dmmulroy/overseer).

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
    "steward": {
      "command": "npx",
      "args": ["-y", "@thxgg/steward", "mcp"]
    }
  }
}
```

The MCP server key (`steward` above) controls the prompt prefix in slash commands.

Steward MCP requires a Node runtime with built-in sqlite support (`node:sqlite`) for `repos`, `prds`, and `state` APIs.
If you see `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, run with sqlite enabled:

```bash
NODE_OPTIONS=--experimental-sqlite npx -y @thxgg/steward mcp
```

Note: `execute` runs in a VM sandbox by design, so globals like `process` are intentionally not exposed.

### CLI

```bash
prd ui
prd ui --port 3100 --host 127.0.0.1
prd mcp
```

## Architecture

```
┌─────────────────────────────────────────┐
│            Steward CLI (Node)           │
│  - `prd ui` runs prebuilt UI server     │
│  - `prd mcp` starts MCP over stdio      │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   Codemode MCP (`execute` + prompts)    │
│  - VM sandbox                           │
│  - APIs: repos, prds, git, state        │
│  - Prompts: create/break/complete flow  │
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

It also exposes workflow prompts:

- `create_prd(feature_request)`
- `break_into_tasks(prd_slug?)`
- `complete_next_task(prd_slug?)`

In OpenCode these are shown as MCP slash entries like `/steward:create_prd:mcp` and inserted as `/steward:create_prd`.

- `prd_slug` is optional for break/complete prompts.
- When omitted, Steward workflows auto-resolve the slug from repo state.
- `complete_next_task` includes required commit hygiene (one-line commit message, no `Co-authored-by`, no task-related dirty changes left behind).

```js
const repo = await repos.current()

const prdList = await prds.list(repo.id)
if (prdList.length === 0) return { repo: repo.name, prds: 0 }

const slug = prdList[0].slug
return {
  doc: await prds.getDocument(repo.id, slug),
  tasks: await prds.getTasks(repo.id, slug),
  progress: await prds.getProgress(repo.id, slug)
}
```

Every call returns a structured envelope:

```json
{
  "ok": true,
  "result": {},
  "logs": [],
  "error": null,
  "meta": {
    "timeoutMs": 30000,
    "durationMs": 10,
    "truncatedResult": false,
    "truncatedLogs": false,
    "resultWasUndefined": false
  }
}
```

Use `steward.help()` inside `execute` for runtime API signatures and examples.

## APIs

Inside `execute`, these APIs are available:

- `repos` - register/list/remove repos and refresh discovered git repos
- `prds` - list/read PRD docs, tasks, progress, and task commit refs
- `git` - commit metadata, diffs, file diffs, and file contents
- `state` - direct PRD state get/upsert by repo id, path, or current repo

Detailed API docs and examples: `docs/MCP.md`

## Local-First Security Model

Steward reads local filesystem and git metadata by design.

- UI/API accept loopback requests only
- Non-loopback requests are rejected
- Treat as a workstation tool, not a hosted multi-user service
- `npm run dev` skips loopback enforcement because Nuxt dev proxying can mask loopback source addresses

On startup, Steward also performs a one-time automatic state migration when legacy `progress_json` data is detected. During this migration, the UI shows a blocking progress overlay until migration completes.

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

## OpenCode Integration

Steward now uses MCP-registered prompts as the single workflow surface.

- Use MCP prompts directly (for example `/steward:create_prd`, `/steward:break_into_tasks`, `/steward:complete_next_task`).
- This repository no longer ships separate OpenCode command/skill bundles for PRD workflows.

## License

MIT
