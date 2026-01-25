# PRD: Keyboard Shortcuts & Command Palette

**Author:** Generated
**Date:** 2026-01-25
**Status:** Draft

## Problem Statement

The PRD Viewer application currently requires mouse interaction for all navigation and actions. Power users and keyboard-centric developers cannot efficiently navigate between PRDs, switch tabs, or perform common actions without reaching for the mouse.

### Current State

All interactions in the app are mouse-driven:
- Clicking the repo selector dropdown to switch repositories
- Clicking PRD names in the sidebar to navigate
- Clicking tab triggers to switch between Document and Task Board views
- Clicking task cards to open detail sheets
- No way to quickly jump to a specific PRD or action

### Impact

- Slower workflow for power users who prefer keyboard navigation
- Reduced accessibility for users who rely on keyboard input
- Inconsistent with modern developer tools that offer command palettes (VS Code, GitHub, Linear, Slack)

## Users

### Primary Users

Developers and technical users who:
- Frequently switch between multiple PRDs throughout the day
- Are accustomed to keyboard-driven interfaces in their IDEs and tools
- Value efficiency and minimal context switching

### Secondary Users

- Accessibility-focused users who navigate primarily via keyboard
- New users discovering app features through the command palette

### User Stories

- As a developer, I want to press `Cmd+K` to open a command palette so that I can quickly jump to any PRD or action
- As a power user, I want keyboard shortcuts for common actions so that I don't need to use my mouse
- As a new user, I want to see available shortcuts so that I can learn the app faster
- As a user, I want to navigate the task board with arrow keys so that I can review tasks efficiently

## Proposed Solution

### Overview

Add a global keyboard shortcut system with a searchable command palette. The command palette serves as both a quick navigation tool and a discoverability mechanism for all available actions.

### Key Features

1. **Command Palette** - A modal dialog triggered by `Cmd/Ctrl+K` that allows fuzzy search across PRDs, repositories, and actions
2. **Global Keyboard Shortcuts** - Direct shortcuts for frequent actions that work anywhere in the app
3. **Keyboard Navigation** - Arrow key navigation within lists (sidebar PRDs, task board cards)
4. **Shortcuts Help Panel** - A dedicated modal showing all available shortcuts, accessible via `Cmd+?` and searchable in the palette

### User Flow

**Command Palette Flow:**
1. User presses `Cmd/Ctrl+K` from anywhere in the app
2. Command palette modal appears with search input focused
3. User types to filter available commands/PRDs
4. User navigates results with arrow keys
5. User presses Enter to execute selected command
6. Palette closes and action is performed

**Direct Shortcut Flow:**
1. User presses a shortcut key combination (e.g., `Cmd+Shift+T`)
2. Action executes immediately (e.g., toggle to Task Board tab)

## Scope

### In Scope

- Command palette component with fuzzy search
- Global keyboard event handling via composable
- Navigation shortcuts:
  - `Cmd/Ctrl+K` - Open command palette
  - `Cmd/Ctrl+J` - Quick jump to PRD (opens palette with PRD filter)
  - `Cmd/Ctrl+Shift+T` - Toggle between Document/Task Board tabs
  - `Cmd/Ctrl+.` - Toggle color theme
  - `Cmd/Ctrl+,` - Open settings/add repository
  - `Escape` - Close modals, sheets, palette
  - `Cmd/Ctrl+?` or `Cmd/Ctrl+/` - Open shortcuts help
- Arrow key navigation in:
  - Command palette results
  - Sidebar PRD list (when focused)
- Command palette actions:
  - Navigate to any PRD
  - Switch repository
  - Toggle theme
  - Open shortcuts help
  - Switch tabs

### Out of Scope

- Vim-style navigation modes
- Custom/user-configurable shortcuts
- Touch gestures or mobile-specific interactions
- Keyboard shortcuts for task editing (create, update, delete)
- Command history or recent commands

### Future Considerations

- User-customizable keybindings stored in localStorage
- Command history with frecency sorting
- Contextual shortcuts based on current view
- Task creation/editing via command palette

## Technical Considerations

### Affected Components

| File | Change |
|------|--------|
| `app/app.vue` | Mount global keyboard listener |
| `app/composables/useKeyboard.ts` | New - keyboard event handling |
| `app/composables/useCommandPalette.ts` | New - palette state and actions |
| `app/components/ui/command/` | Install via `npx shadcn-vue@latest add command` |
| `app/components/CommandPalette.vue` | New - App-specific command palette wrapper |
| `app/components/ShortcutsHelp.vue` | New - Shortcuts help modal |
| `app/layouts/default.vue` | Integrate command palette |

### Dependencies

- `@vueuse/core` - Already installed, provides `useMagicKeys` for keyboard shortcuts
- **shadcn-vue Command component** - Install via `npx shadcn-vue@latest add command`
  - `CommandDialog` - Modal wrapper for the palette
  - `CommandInput` - Search input with built-in filtering
  - `CommandList`, `CommandGroup`, `CommandItem` - Structured results
  - `CommandEmpty`, `CommandSeparator` - Empty state and visual dividers
- Built-in fuzzy search provided by the Command component (no additional library needed)

### Constraints

- Must not conflict with browser default shortcuts
- Must respect when user is typing in input fields (disable shortcuts)
- Must work across all pages and layouts
- Performance: Palette should open instantly (<50ms)

### Patterns to Follow

- Use shadcn-vue `CommandDialog` for the palette modal
- Follow existing composable patterns (`useRepos`, `usePrd`)
- Integrate with `useToast` for action feedback
- Use Tailwind CSS v4 for styling
- Use lucide-vue-next for icons (consistent with existing components)

## Success Criteria

### Metrics

- Command palette opens in <50ms
- All listed shortcuts function correctly
- No conflicts with browser shortcuts

### Acceptance Criteria

- [ ] `Cmd/Ctrl+K` opens command palette from any page
- [ ] Command palette shows searchable list of PRDs and actions
- [ ] Arrow keys navigate palette results, Enter executes
- [ ] `Escape` closes palette and all sheets/modals
- [ ] `Cmd/Ctrl+Shift+T` toggles Document/Task Board tabs
- [ ] `Cmd/Ctrl+.` toggles light/dark theme
- [ ] `Cmd/Ctrl+?` opens shortcuts help modal
- [ ] Shortcuts are disabled when typing in input fields
- [ ] Help modal shows all available shortcuts with descriptions
- [ ] "Show shortcuts" action available in command palette

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shortcut conflicts with browser | Medium | High | Test across browsers, use non-conflicting combos |
| Shortcuts fire during text input | Medium | High | Check `activeElement` before executing |
| Command palette slows with many PRDs | Low | Medium | Virtual scrolling or limit displayed results |
| Accessibility issues | Low | High | Follow ARIA patterns, test with screen readers |

## Open Questions

- [ ] Should the command palette support markdown preview for PRD descriptions?
- [ ] Should arrow key navigation in sidebar be opt-in (require focus) or always active?

## Implementation Phases

**Phase 1: Core Infrastructure**
- Install shadcn-vue Command component (`npx shadcn-vue@latest add command`)
- Create `useKeyboard` composable with `useMagicKeys` for shortcut handling
- Create `CommandPalette.vue` wrapper using `CommandDialog`
- Implement basic open/close with `Cmd+K` and `Escape`

**Phase 2: Navigation Commands**
- Populate palette with PRD navigation
- Add repository switching
- Implement fuzzy search filtering

**Phase 3: Action Commands**
- Add theme toggle
- Add tab switching shortcut
- Add other action commands

**Phase 4: Help & Polish**
- Create shortcuts help modal
- Add visual hints in UI for available shortcuts
- Accessibility testing and refinement

---

*Generated with /prd skill*
