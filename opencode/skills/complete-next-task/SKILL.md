---
name: complete-next-task
description: Complete the next incomplete task from a PRD
---

# Complete Next Task from PRD

Complete one task from a PRD file. Implements the next incomplete task, runs feedback loops, commits, and captures commit SHAs for traceability.

## Usage

```
/complete-next-task <prd-name>
```

Where `<prd-name>` matches a PRD slug from `docs/prd/`.

## State Discovery

State is stored in a global SQLite database, not in the local repository. Before starting, fetch the state into a temporary directory:

```bash
mkdir -p /tmp/prd-state/<prd-name>
bun run ~/.config/opencode/scripts/prd-db.ts get-state "$(pwd)" "<prd-name>" "/tmp/prd-state/<prd-name>"
```

This will create:
```
/tmp/prd-state/<prd-name>/
├── tasks.json     # Task list with pass criteria and status fields
└── progress.json  # Cross-iteration memory (patterns, task logs)
```

**IMPORTANT:** Always read and modify the files from `/tmp/prd-state/<prd-name>/`. Do not look for a `.claude` directory.

Legacy note: some historical task files may contain boolean `passes` values. Treat those as legacy data and do not write new boolean `passes` values.

## Process

### 1. Get Bearings

- Read `/tmp/prd-state/<prd-name>/progress.json` - **CHECK 'patterns' ARRAY FIRST**
- Read `/tmp/prd-state/<prd-name>/tasks.json` - find next task to execute:
  - Prefer task with `status: "in_progress"` (resume unfinished work)
  - Otherwise pick next task with `status: "pending"`
  - Treat `passes` as pass criteria only (array), not execution state
  - **Task Priority** (highest to lowest):
    1. Architecture/core abstractions
    2. Integration points
    3. Spikes/unknowns
    4. Standard features
    5. Polish/cleanup
- Check recent git history: `git log --oneline -10`

### 2. Initialize Progress (if needed)

If `progress.json` doesn't exist or is empty, initialize it.

**Get current UTC timestamp using bash:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

```json
{
  "prdName": "<prdName from tasks.json>",
  "started": "<UTC timestamp from bash>",
  "patterns": [],
  "taskLogs": []
}
```

### 3. Mark Task as In Progress

Before starting work, update both files to track the task pickup:

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**In tasks.json:** Set the task's `status` field to `"in_progress"`:
```json
{
  "id": "task-1",
  "status": "in_progress",
  "startedAt": "<UTC timestamp from bash>"
}
```

**In progress.json:** Add an entry to `taskLogs` with `status: "in_progress"`:
```json
{
  "taskId": "<task.id>",
  "status": "in_progress",
  "startedAt": "<UTC timestamp from bash>"
}
```

**Sync to Database:**
```bash
bun run ~/.config/opencode/scripts/prd-db.ts save-state "$(pwd)" "<prd-name>" "/tmp/prd-state/<prd-name>/tasks.json" "/tmp/prd-state/<prd-name>/progress.json"
```

### 4. Branch Setup

Extract `prdName` from PRD, then:
- `git checkout -b <prdName>` (or checkout existing branch)

### 5. Implement Task

Work on the single task until verification steps pass.

### 6. Feedback Loops (REQUIRED)

Before committing, run ALL applicable:
- Type checking (tsc, mypy, etc.)
- Tests (jest, pytest, cargo test, etc.)
- Linting (eslint, ruff, clippy, etc.)
- Formatting (prettier, black, rustfmt, etc.)

**Do NOT commit if any fail.** Fix issues first.

### 7. Update Tasks JSON

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Update the task in `tasks.json`:
- Keep `passes` unchanged (it is a list of pass criteria)
- Set `status` to `"completed"`
- Set `completedAt` to the UTC timestamp

### 8. Update Progress JSON

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Find the existing `taskLogs` entry (created in step 3) and update it:

```json
{
  "taskId": "<task.id>",
  "status": "completed",
  "startedAt": "<original startedAt value>",
  "completedAt": "<UTC timestamp from bash>",
  "implemented": "<what was implemented>",
  "filesChanged": ["<file1>", "<file2>"],
  "learnings": "<patterns, gotchas discovered>",
  "commits": []
}
```

Note: The `commits` array will be populated after step 9 (Commit) - see step 10.

If you discover a **reusable pattern**, also add to the `patterns` array.

### 9. Commit

Follow the commit logic from the `/commit` skill:

1. Run `git status` to see staged and unstaged changes
2. Run `git diff --cached` to see what will be committed (if files are staged)
3. Run `git diff` to see unstaged changes (if nothing is staged yet)
4. Stage relevant files (avoid `git add -A` to prevent staging unrelated changes)
5. Analyze changes to determine if they should be split into separate commits:
   - If changes are logically distinct (e.g., a bug fix AND a new feature), split them
   - Each commit should represent a single logical change
6. Create a concise one-line commit message following conventional commits format (feat, fix, chore, docs, refactor, test)
7. Commit with: `git commit -m "message"` (no co-authored-by footer)

### 10. Capture Commit SHAs with Repo Context

After committing, capture the SHA(s) of commits made for this task. For pseudo-monorepos (where git repos are in subfolders), also record which repo each commit belongs to.

**Step 10a: Get the commit SHA:**
```bash
git rev-parse HEAD
```

**Step 10b: Detect repo context for pseudo-monorepos:**

Determine if you're working in a subfolder git repo:

```bash
# Get current git repo root
CURRENT_GIT_ROOT=$(git rev-parse --show-toplevel)

# Get the registered repo path by walking up to find docs/prd
REGISTERED_REPO=$(cd "$(pwd)" && while [ ! -d "docs/prd" ] && [ "$(pwd)" != "/" ]; do cd ..; done && pwd)

# Calculate relative path (empty if same as registered repo)
RELATIVE_REPO=$(python3 -c "import os; print(os.path.relpath('$CURRENT_GIT_ROOT', '$REGISTERED_REPO'))" 2>/dev/null || echo "")
```

**Step 10c: Format the commit entry:**

- If `RELATIVE_REPO` is empty or `.` (current git is at registered repo root): use plain string SHA
- If `RELATIVE_REPO` has a value (subfolder git repo): use CommitRef object `{ "sha": "<sha>", "repo": "<relative_path>" }`

**Example for pseudo-monorepo (working in `code-hospitality-backend` subfolder):**
```json
{
  "taskId": "<task.id>",
  "commits": [{ "sha": "abc123", "repo": "code-hospitality-backend" }]
}
```

**Example for standard repo (git at root):**
```json
{
  "taskId": "<task.id>",
  "commits": ["abc123"]
}
```

If multiple commits were made for the task, capture each SHA with appropriate repo context. Then update the `commits` array in the taskLog entry in `/tmp/prd-state/<prd-name>/progress.json`.

**Important:** Only add the feat/fix/refactor commits for the task implementation, not the chore commit for updating task status (that comes after).

### 11. Final Sync to Database

Once `/tmp/prd-state/<prd-name>/tasks.json` and `/tmp/prd-state/<prd-name>/progress.json` have been fully updated with the completion logic, you **MUST** save the state to the global database:

```bash
bun run ~/.config/opencode/scripts/prd-db.ts save-state "$(pwd)" "<prd-name>" "/tmp/prd-state/<prd-name>/tasks.json" "/tmp/prd-state/<prd-name>/progress.json"
```

## Completion

If all tasks have `status: "completed"`, output:

```
<tasks>COMPLETE</tasks>
```

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Patterns you establish will be copied. Corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

<user-request>
$ARGUMENTS
</user-request>
