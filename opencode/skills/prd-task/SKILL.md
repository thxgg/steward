---
name: prd-task
description: Convert markdown PRDs into executable JSON task format
---

# PRD Task Converter Skill

You convert Product Requirements Documents (PRDs) into structured, executable task files that can be tracked and executed systematically.

## Input

The user will provide:
1. A path to a markdown PRD file, OR
2. A PRD name to search for in `docs/prd/`

If no PRD is specified, list available PRDs and ask which to convert.

## State Storage

PRD state is stored in a global SQLite database managed by `prd-viewer`, not in the local repository.
To convert and save a new PRD:

1. Create a temporary directory to build the state files:
   ```bash
   mkdir -p /tmp/prd-state/<prd-name>
   ```
2. Write the generated `tasks.json` and `progress.json` into this temporary directory.
3. Save the state to the global database using the provided CLI tool:
   ```bash
   bun run ~/.config/opencode/scripts/prd-db.ts save-state "$(pwd)" "<prd-name>" "/tmp/prd-state/<prd-name>/tasks.json" "/tmp/prd-state/<prd-name>/progress.json"
   ```

## Task Schema

See `references/prd-schema.json` for the full schema. Key structure:

```json
{
  "prd": {
    "name": "Feature Name",
    "source": "docs/prd/feature-name.md",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "tasks": [
    {
      "id": "task-001",
      "category": "setup|feature|integration|testing|documentation",
      "title": "Short task title",
      "description": "Detailed description of what needs to be done",
      "steps": [
        "Specific step 1",
        "Specific step 2"
      ],
      "passes": [
        "Verification criterion 1",
        "Verification criterion 2"
      ],
      "dependencies": ["task-000"],
      "priority": "critical|high|medium|low",
      "status": "pending"
    }
  ]
}
```

## Conversion Process

### 0. Update PRD Status

Before parsing, update the PRD's status from "Draft" to "Approved":
1. Read the source PRD file
2. Replace `**Status:** Draft` with `**Status:** Approved`
3. Write the updated PRD back to disk

This marks the PRD as finalized and ready for implementation.

### 1. Parse the PRD

Extract from the PRD:
- **In Scope items** -> Tasks
- **User Stories** -> Tasks or subtasks
- **Acceptance Criteria** -> Pass criteria
- **Technical Considerations** -> Setup/integration tasks
- **Affected Components** -> File references in task descriptions

### 2. Categorize Tasks

Assign categories based on task nature:
- `setup` - Environment, dependencies, configuration
- `feature` - Core functionality implementation
- `integration` - Connecting components, APIs
- `testing` - Test creation and validation
- `documentation` - User docs, API docs, comments

### 3. Order by Dependencies

Determine task order:
1. Setup tasks first
2. Core features in logical order
3. Integrations after their dependencies
4. Testing after features
5. Documentation last

### 4. Generate Pass Criteria

Each task needs verifiable completion criteria:
- Be specific and testable
- Reference acceptance criteria from PRD
- Include both functional and quality checks

## Progress Tracking

Create `progress.json`:

```json
{
  "prdName": "Feature Name",
  "totalTasks": 12,
  "completed": 0,
  "inProgress": 0,
  "blocked": 0,
  "startedAt": null,
  "lastUpdated": "2024-01-15T10:00:00Z",
  "taskProgress": {}
}
```

## Output

After conversion, report:
1. Number of tasks generated
2. Task breakdown by category
3. Critical path (tasks that must be done first)
4. Suggested starting point

## Example Usage

User: `/prd-task docs/prd/user-auth.md`

Output:
```
Converted PRD "User Authentication" to tasks and saved to the global database.

Task Summary:
- Setup: 2 tasks
- Feature: 5 tasks
- Integration: 2 tasks
- Testing: 3 tasks
- Documentation: 1 task

Critical Path:
1. [setup] Configure auth middleware
2. [feature] Implement login endpoint
3. [feature] Implement session management

Start with: task-001 "Configure auth middleware"
```
