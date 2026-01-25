# Implementation Notes: Keyboard Shortcuts & Command Palette

## Key Decisions

- Using shadcn-vue Command component (installed via CLI)
- Using @vueuse/core's `useMagicKeys` for keyboard handling
- Global shortcuts disabled when user is typing in input fields
- Platform detection for showing correct modifier key (⌘ vs Ctrl)

## Technical Notes

### Shortcut Registry

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+K | Open command palette |
| Cmd/Ctrl+J | Quick jump to PRD (palette with filter) |
| Cmd/Ctrl+Shift+T | Toggle Document/Task Board tabs |
| Cmd/Ctrl+. | Toggle theme |
| Cmd/Ctrl+, | Open add repository |
| Cmd/Ctrl+? | Open shortcuts help |
| Escape | Close modals/palette |

### Input Field Detection

Check these selectors before firing shortcuts:
- `input`
- `textarea`
- `[contenteditable="true"]`
- Elements with `role="textbox"`

## Open Questions

- [ ] Should the command palette support markdown preview for PRD descriptions?
- [ ] Should arrow key navigation in sidebar be opt-in (require focus) or always active?

## Progress Log

*Notes will be added here during implementation*
