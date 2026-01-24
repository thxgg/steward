# PRD Viewer - Implementation Notes

## Decisions

- Using Nuxt 4 with shadcn-vue as specified
- Server-side API routes read filesystem directly (no browser permission prompts)
- Repository configs stored server-side in JSON file (not localStorage) for server access
- Using SSE for file watching notifications (simpler than WebSocket for this use case)

## Reference Data

Test repository: `/Users/thxgg/Projects/Work/code-hospitality-monorepo`
- Contains 2 PRDs: `waiting-for-approval-page-update`, `offer-preview-button`
- Has `.claude/state/` directories with tasks.json and progress.json

## Open Items

- [ ] Decide on markdown rendering library (@nuxt/content vs marked + shiki)
- [ ] Determine exact shadcn-vue theme configuration for system color mode
