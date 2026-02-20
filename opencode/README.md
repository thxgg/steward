# OpenCode Bundle

This directory contains the OpenCode commands, skills, and scripts used by PRD Viewer workflows.

Included:

- Commands: `prd`, `prd-task`, `complete-next-task`, `commit`
- Skills: `prd`, `prd-task`, `complete-next-task`, `commit`
- Script: `scripts/prd-db.ts`

Excluded on purpose:

- `frontend-design`

Install into local OpenCode config:

```bash
mkdir -p ~/.config/opencode
cp -R opencode/commands ~/.config/opencode/
cp -R opencode/skills ~/.config/opencode/
cp -R opencode/scripts ~/.config/opencode/
```
