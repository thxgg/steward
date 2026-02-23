# Steward MCP Codemode

Steward ships a codemode MCP server.

- Command: `prd mcp`
- Transport: stdio
- Tool surface: one tool, `execute`

The `execute` tool runs JavaScript in a VM sandbox with these APIs in scope:

- `repos`
- `prds`
- `git`
- `state`

## Quick Start

Start MCP server directly:

```bash
prd mcp
```

Without global install:

```bash
npx -y @thxgg/steward mcp
```

Or from this repo without linking:

```bash
npm run mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "prd": {
      "command": "prd",
      "args": ["mcp"]
    }
  }
}
```

## Execute Contract

`execute` expects one input field:

```json
{
  "code": "return { ok: true }"
}
```

Your code is wrapped in an async function, so you can use `await` directly.

Each call returns a JSON envelope:

```json
{
  "ok": true,
  "result": {},
  "logs": [],
  "error": null,
  "meta": {
    "timeoutMs": 30000,
    "durationMs": 12,
    "truncatedResult": false,
    "truncatedLogs": false,
    "resultWasUndefined": false
  }
}
```

- `result` is `null` when your code does not explicitly return a value.
- `logs` contains captured `console.log/info/warn/error` output from sandbox code.
- `error` is populated with `{ code, message, stack?, details? }` on failure.

In-sandbox discovery helper:

- `steward.help()`

## Available APIs

### `repos`

- `repos.list()`
- `repos.get(repoId)`
- `repos.current()`
- `repos.add(path, name?)`
- `repos.remove(repoId)`
- `repos.refreshGitRepos(repoId)`

### `prds`

- `prds.list(repoId)`
- `prds.getDocument(repoId, prdSlug)`
- `prds.getTasks(repoId, prdSlug)`
- `prds.getProgress(repoId, prdSlug)`
- `prds.getTaskCommits(repoId, prdSlug, taskId)`

### `git`

- `git.getCommits(repoId, shas, repoPath?)`
- `git.getDiff(repoId, commit, repoPath?)`
- `git.getFileDiff(repoId, commit, file, repoPath?)`
- `git.getFileContent(repoId, commit, file, repoPath?)`

### `state`

- `state.get(repoId, slug)`
- `state.getByPath(repoPath, slug)`
- `state.getCurrent(slug)`
- `state.summaries(repoId)`
- `state.summariesByPath(repoPath)`
- `state.summariesCurrent()`
- `state.upsert(repoId, slug, payload)`
- `state.upsertByPath(repoPath, slug, payload)`
- `state.upsertCurrent(slug, payload)`

`payload` supports any combination of:

- `tasks`
- `progress`
- `notes`

## Codemode Examples

List repos and PRDs:

```js
const reposList = await repos.list()
return await Promise.all(reposList.map(async (repo) => ({
  id: repo.id,
  name: repo.name,
  prds: await prds.list(repo.id)
})))
```

Load one PRD with state:

```js
const repo = await repos.current()
const slug = 'prd-viewer'

return {
  doc: await prds.getDocument(repo.id, slug),
  tasks: await prds.getTasks(repo.id, slug),
  progress: await prds.getProgress(repo.id, slug)
}
```

Inspect commits for one task and fetch diffs:

```js
const repo = (await repos.list())[0]
const commits = await prds.getTaskCommits(repo.id, 'prd-viewer', 'task-001')

return await Promise.all(commits.map(async (entry) => ({
  entry,
  meta: await git.getCommits(repo.id, [entry.sha], entry.repo),
  diff: await git.getDiff(repo.id, entry.sha, entry.repo)
})))
```

Inspect signatures at runtime:

```js
return steward.help()
```

Update state in the current repo (no repoId required):

```js
const slug = 'prd-viewer'

await state.upsertCurrent(slug, {
  notes: '# Updated from codemode'
})

return { saved: true }
```

Update state directly by path (replacement for shell helpers):

```js
const repoPath = '/absolute/path/to/repo'
const slug = 'prd-viewer'

const existing = await state.getByPath(repoPath, slug)

await state.upsertByPath(repoPath, slug, {
  progress: {
    ...(existing?.progress ?? {
      prdName: 'PRD Viewer',
      totalTasks: 0,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: new Date().toISOString(),
      patterns: [],
      taskLogs: []
    }),
    lastUpdated: new Date().toISOString()
  }
})

return { saved: true }
```

## Limits

- Execution timeout: 30 seconds
- Result preview limit: 50,000 characters
- Captured log limit: 20,000 characters (max 200 log entries)
- Timer limit: 100 active timers in sandbox

## Safety Notes

- This server is for trusted local development.
- APIs can read local filesystem and git history for registered repositories.
- Do not expose this server to untrusted environments.
