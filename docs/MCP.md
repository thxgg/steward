# PRD MCP Codemode

PRD Viewer now ships a codemode MCP server.

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

Or from this repo without linking:

```bash
bun run ./bin/prd mcp
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

Return values are JSON-stringified in the MCP response.

## Available APIs

### `repos`

- `repos.list()`
- `repos.get(repoId)`
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
- `state.summaries(repoId)`
- `state.summariesByPath(repoPath)`
- `state.upsert(repoId, slug, payload)`
- `state.upsertByPath(repoPath, slug, payload)`

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
const repo = (await repos.list())[0]
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
- Output preview limit: 50,000 characters
- Timer limit: 100 active timers in sandbox

## Safety Notes

- This server is for trusted local development.
- APIs can read local filesystem and git history for registered repositories.
- Do not expose this server to untrusted environments.
