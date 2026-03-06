# PRD: Steward OpenCode Workspace Launcher

**Author:** Generated
**Date:** 2026-02-28
**Status:** Approved

## Problem Statement

Steward works well as a local-first PRD viewer and MCP workflow surface, but using it as a complete build cockpit still requires manual, fragmented setup:

- Launch Steward separately from OpenCode.
- Manually start/attach to an OpenCode instance.
- Switch to an external terminal to interact with that same instance.
- Manually run recurring PRD workflow actions (`break_into_tasks`, `complete_next_task`).

This creates context switching, increased operational overhead, and avoidable state drift risk across tools.

### Current State

- Steward exposes PRD workflows via MCP prompts and local SQLite state.
- OpenCode supports `tui`, `serve`, `web`, `attach`, and `run --attach` modes.
- OpenCode server mode exposes HTTP APIs suitable for embedding/control.
- OpenCode desktop uses a sidecar process model for lifecycle management.
- Ghostty/libghostty exists, but public/stable embedding ergonomics are still evolving.

### Why This Matters

- Users want one launch point with full context continuity.
- PRD workflow should be executable from the same interface where PRD state is viewed.
- The terminal must be integrated with the exact active OpenCode instance, not a disconnected shell.
- Browser mirror behavior should avoid state duplication and stale sessions.

## Users

### Primary Users

- Individual developers running PRD-driven implementation loops with Steward + OpenCode.

### Secondary Users

- Power users managing multiple workspaces/sessions.
- Users monitoring and continuing work from both desktop and browser surfaces.

### User Stories

- As a developer, I want to launch Steward in a mode that also manages OpenCode so I can start work immediately.
- As a developer, I want an integrated terminal bound to the specific OpenCode instance/session so I can stay in one context.
- As a developer, I want one-click controls to break the current PRD into tasks and move to the next task.
- As a developer, I want browser access patterns that reflect live desktop state rather than spawning disconnected copies.

## Proposed Solution

Build a desktop-first Steward workspace launcher that preserves all existing Steward functionality and adds first-class OpenCode orchestration.

### Core Capabilities

1. **OpenCode Instance Manager**
   - Start/stop/health-check OpenCode for the active workspace.
   - Reuse healthy instances where appropriate.
   - Surface clear connection state (`starting`, `healthy`, `degraded`, `stopped`).

2. **Integrated Terminal via libghostty (strict requirement)**
   - Embed terminal interaction directly in Steward using libghostty.
   - Bind terminal I/O to the managed OpenCode instance/session.
   - No fallback terminal renderer in this product direction.

3. **Workflow Action Controls**
   - `Break Current PRD Into Tasks`
   - `Complete Next Task`
   - Actions execute against the same managed OpenCode context and report status inline.

4. **Mirror-Aware Runtime Model**
   - Use existing OpenCode web/desktop server patterns as direction for architecture.
   - Prefer a single backing server + mirror/proxy client model over duplicate server instances when browser access is required.

### End-to-End Flow

1. User launches Steward workspace mode.
2. Steward resolves repo + PRD context and ensures OpenCode instance availability.
3. Embedded terminal attaches to the active OpenCode session context.
4. User executes PRD workflow actions via buttons.
5. Steward state, terminal feedback, and OpenCode session output remain synchronized.

## Scope

This PRD targets the intended end-state architecture. Delivery can be phased, but the direction below is authoritative.

### In Scope

- Preserve all existing Steward PRD viewing/state features.
- Desktop-hosted launcher and process orchestration for OpenCode.
- Strict libghostty-based integrated terminal.
- In-UI workflow action controls for PRD operations.
- Health/status/recovery UX for OpenCode lifecycle failures.
- Architecture alignment with OpenCode server/mirror patterns for future browser access.

### Out of Scope

- Multi-user collaboration or hosted SaaS orchestration.
- Replacing Steward MCP prompts with a new workflow engine.
- Exposing unrestricted remote shell control by default.
- Temporary terminal implementations that diverge from strict libghostty direction.

## Technical Considerations

### Research Summary: OpenCode

- `opencode serve` runs a headless HTTP server with OpenAPI-described endpoints.
- `opencode web` runs browser UI but can represent a separate process/state surface if not mirrored.
- `opencode attach` and `run --attach` support shared backend usage from multiple clients.
- OpenCode desktop sidecar flow is a strong reference for:
  - local server spawn
  - health checks before ready
  - app-bound lifecycle termination
  - custom/default server URL selection

### Research Summary: Ghostty and libghostty

- Ghostty core is designed around libghostty.
- `libghostty-vt` is shipping directionally, with broader libghostty embedding continuing to mature.
- Existing Ghostty docs and source indicate practical capability, but API stability is still a risk surface.
- Product direction for this PRD is strict libghostty integration despite maturity risk.

### Research Summary: Comparable Patterns

- Mux demonstrates integrated terminal UX using Ghostty technology (`ghostty-web`) and provides strong product references for session-centric workflows.
- OpenCode desktop/web mirror efforts reinforce the importance of avoiding duplicate in-memory server state.
- Overseer reinforces the codemode model (single execution surface + persistent task context), which aligns with Steward MCP workflow actions.

### Architecture Direction

1. **Desktop Host Layer**
   - Steward UI remains the command surface.
   - Native host layer manages OpenCode and terminal runtime bindings.

2. **OpenCode Lifecycle Service**
   - Start local OpenCode server with explicit auth and localhost defaults.
   - Reuse healthy local instance or attach to configured target when valid.
   - Publish health events to the UI.

3. **Session Bridge**
   - Resolve/create active session deterministically.
   - Route workflow actions and terminal traffic through that same session identity.

4. **libghostty Terminal Adapter**
   - Native terminal surface embedded in Steward.
   - PTY and process wiring tied to OpenCode runtime.
   - Input/output buffering and resize handling at host boundary.

5. **Future Mirror Path**
   - Browser access should connect to the same backing server where feasible.
   - Avoid disconnected duplicate servers for the same workspace.
   - Treat desktop and web as clients only; all real actions execute on the shared underlying engine/server.

### Security and Safety

- Default localhost binding for managed OpenCode instances.
- Explicit opt-in for any network-visible mode.
- Auth required for non-localhost exposure.
- Capability restrictions for mirrored/browser surfaces where necessary.

## Success Criteria

### Product Outcomes

- Steward becomes a single launch point for PRD workflow and execution.
- Terminal interaction no longer requires leaving Steward.
- PRD workflow actions become one-click operations against active context.
- Session continuity is maintained across UI and terminal surfaces.

### Acceptance Criteria

- [ ] Existing Steward functionality remains intact.
- [ ] Steward can manage OpenCode instance lifecycle for the active workspace.
- [ ] Integrated terminal is embedded via libghostty and bound to managed OpenCode context.
- [ ] `Break Current PRD Into Tasks` executes against the selected PRD slug.
- [ ] `Complete Next Task` executes against the selected PRD slug.
- [ ] Health and recovery states are visible and actionable in UI.
- [ ] Runtime model supports eventual mirror/browser access without duplicate-state confusion.

### Operational Metrics

- Managed instance readiness after launch is predictable and observable.
- Workflow button actions complete with clear success/failure telemetry.
- Crash/restart behavior avoids orphaned runtime state.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| libghostty integration complexity/stability | Medium | High | Keep host-terminal boundary explicit, validate against upstream frequently, budget integration hardening |
| State divergence across desktop/browser runtime surfaces | Medium | High | Favor single backing server model; avoid duplicate instance patterns |
| Security exposure if remote terminal access is enabled | Medium | High | Localhost defaults, explicit opt-in, auth enforcement, restricted capabilities |
| Cross-platform PTY/process edge cases | Medium | Medium | Reuse sidecar lifecycle patterns and platform-specific test matrix |
| Increased resource usage from orchestration | Medium | Medium | Instance reuse policies, health-driven restart, optional idle controls |

## Key Product Decisions

- Desktop-first architecture is the primary experience.
- Existing Steward behavior stays intact; this is an expansion, not a rewrite.
- libghostty integration is strict product direction.
- OpenCode web/desktop behavior is used as architectural guidance, not parity target.
- Mirror/browser support should preserve a single live runtime state where possible.
- Workflow action buttons execute in the active OpenCode session (not a separate hidden automation session).
- Terminal scope starts with core interactive capabilities (no split panes): input/output, prompt interaction, copy/paste, resize, scrollback, and reliable session attachment.
- Runtime model should be 1:1 between desktop/web clients and the same backing engine/server; localhost transport is acceptable when that best preserves shared state.

## Open Questions

- None currently. The previously open session model, terminal baseline, and 1:1 runtime model decisions are now resolved.
