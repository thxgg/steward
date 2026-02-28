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
prd sync export ./steward-sync.json
prd sync inspect ./steward-sync.json
prd sync merge ./steward-sync.json
prd sync merge ./steward-sync.json --apply
prd sync merge ./steward-sync.json --apply --map rsk_source=/Users/you/Projects/repo
```

### Sync Bundles (Cross-Device)

Steward supports local-first state sharing across devices using portable JSON bundles.

- `prd sync export <bundle-path>` writes a versioned bundle of repos/state/archives.
- `prd sync inspect <bundle-path>` validates and summarizes bundle contents.
- `prd sync merge <bundle-path>` plans a merge in dry-run mode by default.
- `prd sync merge <bundle-path> --apply` applies the planned merge transactionally.

Path hint privacy defaults:

- Export defaults to `--path-hints basename` to avoid leaking absolute filesystem paths.
- Use `--path-hints none` to omit path hints entirely.
- Use `--path-hints absolute` only when you explicitly want full paths in the bundle.

Representative command output summaries:

- `sync export` prints bundle path, bundle id, and row totals (`repos/states/archives`).
- `sync inspect` prints bundle metadata (`bundleId`, `sourceDeviceId`, format version), totals, and unknown references.
- `sync merge` prints mapping totals, state/archive action counts, and conflict counts.
- `sync merge --apply` also prints backup path and retention cleanup counts.

Safety defaults and retention:

- Merge defaults to dry-run; no writes happen unless `--apply` is provided.
- Apply creates a SQLite backup before any write and runs an integrity check before commit.
- Re-applying the same bundle id is idempotent and returns a no-op result.
- Default retention keeps backups for 30 days (max 20 files) and sync apply logs for 180 days (max 10,000 rows).

Troubleshooting sync:

- Unresolved mapping on apply: run `prd sync inspect <bundle-path>` and pass one or more `--map <incomingRepoSyncKey>=<localPathOrRepoRef>` values.
- Expected no-op reapply: if bundle id was already applied, merge returns "already applied" and leaves state unchanged.
- Restore from backup: stop Steward processes, then replace your DB file with a backup in the same directory (files match `state.db.sync-backup.*.db`).

## Architecture

```
┌─────────────────────────────────────────┐
│            Steward CLI (Node)           │
│  - `prd ui` runs prebuilt UI server     │
│  - `prd sync` manages state bundles     │
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
