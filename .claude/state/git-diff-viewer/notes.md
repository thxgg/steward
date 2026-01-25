# Git Diff Viewer - Implementation Notes

## Decisions

- **Commit linking**: Manual annotation via `/complete-next-task` skill capturing commit SHA after each commit
- **Diff display**: Side-by-side view with synchronized scrolling
- **UI location**: Integrated into task detail panel as "Changes" section
- **Minimap**: Visual file list with proportional add/delete bars for quick navigation

## Technical Notes

- Reuse existing `shiki` for syntax highlighting in diff viewer
- Use native `child_process.spawn` for git commands (no additional dependencies needed)
- Leverage existing repo configuration from repo selector
- Path validation critical to prevent traversal attacks

## Open Questions

1. Auto-detect vs prompt for commit SHA in skill?
2. Maximum file size for truncation (currently planning 10000 lines)?
3. Range diff support for multiple commits (deferred to future)?
