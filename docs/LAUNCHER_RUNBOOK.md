# Launcher Architecture and Operations Runbook

This runbook documents the desktop launcher model used by Steward, including architecture boundaries, security defaults, operational workflows, and recovery procedures.

## Architecture Overview

Steward launcher mode is a host-managed runtime with three core services:

- OpenCode engine lifecycle manager
- active-session bridge
- libghostty terminal bridge

The runtime boundary is:

- **Host process** (`host/src/launcher/*`): owns process lifecycle, session/terminal transport, and control server.
- **Nuxt UI + server APIs** (`app/*`, `server/api/*`): renders state and proxies user actions through the host control channel.

Launcher state is exposed to UI clients through `/api/runtime` and includes:

- engine identity (`instanceKey`) and connection mode (`shared`/`external`/`unavailable`)
- security posture (`bindingMode`, `authMode`)
- active session state
- terminal bridge state

## 1:1 Shared Engine + Active Session Model

Steward enforces a single shared engine endpoint per workspace when possible.

- Launcher attempts endpoint reuse before spawning a managed engine.
- Local endpoint reuse is preferred to avoid duplicate engines.
- Session routing is deterministic: explicit session -> persisted session -> created session.
- Workflow buttons and terminal I/O are both routed through the active session identity.

If active session identity changes while terminal is attached:

- terminal enters a `requiresReattach` state
- terminal input is blocked until explicit reattach confirmation
- UI actions continue to target active session bridge identity

This prevents hidden session drift between buttons and terminal input.

## Security Defaults

Launcher security posture is safe-by-default:

- network-visible engine binding is blocked unless explicitly enabled
- localhost binding is allowed by default
- managed engine startup generates auth token when none is provided

### Security-related Environment Variables

- `STEWARD_OPENCODE_URL`: preferred existing endpoint to reuse
- `STEWARD_OPENCODE_LOCAL_URL`: managed local endpoint (default `http://127.0.0.1:4096`)
- `STEWARD_OPENCODE_ALLOW_REMOTE`: set `1`/`true` to opt into network-visible endpoint usage
- `STEWARD_OPENCODE_AUTH_TOKEN`: explicit auth token for endpoint reuse/session bridge access
- `OPENCODE_AUTH_TOKEN` / `OPENCODE_API_KEY`: fallback auth token env vars

Auth posture in runtime status:

- `generated`: managed launcher generated token
- `provided`: token provided via env/options
- `none`: no token active

Binding posture in runtime status:

- `localhost`: loopback-only endpoint
- `network`: non-loopback endpoint
- `unavailable`: endpoint not currently resolved

## Terminal Baseline and Constraints

Launcher terminal is strict libghostty (no fallback renderer).

Baseline behaviors:

- attach/detach
- input/output streaming via session bridge events
- resize + scrollback buffer
- automatic reattach after temporary bridge unavailability recovery
- explicit reattach required when session identity changes

Known operational constraints:

- terminal input requires attached state and ready session bridge
- mismatch between terminal-bound session and bridge response degrades terminal until reattach
- `requiresReattach=true` blocks input by design

## Workflow Buttons and User Guidance

In launcher mode, PRD page buttons dispatch directly to active session:

- Break Into Tasks -> `/steward:break_into_tasks <slug>`
- Complete Next Task -> `/steward:complete_next_task <slug>`

Guidance:

- keep launcher terminal and workflow buttons on the same active session
- if terminal shows reattach warning, confirm reattach before entering commands
- avoid switching sessions mid-operation while task workflows are running

Duplicate-click protection is enabled for workflow actions to prevent duplicate command dispatch.

## Operational Runbook

### Start launcher

```bash
prd launcher --repo <repo-id-or-path> --prd <slug>
```

### Read runtime posture

From launcher UI banner:

- engine state (`starting`, `healthy`, `degraded`, `stopped`)
- engine identity + connection mode
- security posture (`binding`, `auth`)

### Lifecycle controls

- `retry`: no-op if already healthy; otherwise restart attempt
- `reconnect`: rebuilds lifecycle + session/terminal bridges
- `restart`: explicit full lifecycle restart

## Recovery and Troubleshooting

### Engine degraded

Symptoms:

- engine state `degraded`
- diagnostics report failed endpoint probe or startup timeout

Actions:

1. Verify endpoint settings (`STEWARD_OPENCODE_URL`, `STEWARD_OPENCODE_LOCAL_URL`).
2. For network endpoint use, confirm `STEWARD_OPENCODE_ALLOW_REMOTE=1`.
3. Ensure auth token is present for network-visible reuse (`STEWARD_OPENCODE_AUTH_TOKEN`).
4. Use launcher `reconnect` or `restart` action.

### Session bridge unavailable

Symptoms:

- session state not `ready`
- terminal state `disabled` or `degraded`

Actions:

1. Restore engine health first.
2. Re-run lifecycle action (`retry` or `reconnect`).
3. Confirm session resolution in runtime state.

### Terminal requires reattach

Symptoms:

- terminal state `degraded`
- `requiresReattach=true`
- message indicates session switched or mismatch detected

Actions:

1. Confirm reattach in UI terminal panel.
2. Re-send command after terminal returns to `attached`.
3. If mismatch repeats, inspect active session id and terminal session id.

### Cross-client continuity checks

If desktop and web clients appear out of sync:

1. Confirm both report same engine `instanceKey` and endpoint.
2. Confirm same active session id.
3. Check terminal diagnostics for mismatch errors.
4. Reattach terminal, then rerun a single known command to confirm shared output cursor advances on both clients.

## Validation Coverage

Automated coverage includes:

- engine lifecycle reuse, startup timeout, remote opt-in/auth gate scenarios
- session bridge deterministic active-session routing
- terminal attach/input/output/resize/recovery + mismatch regressions
- cross-client continuity simulation through launcher control server

Primary tests:

- `tests/launcher-engine-lifecycle.test.mjs`
- `tests/launcher-session-bridge.test.mjs`
- `tests/launcher-terminal-bridge.test.mjs`
- `tests/launcher-cross-client-continuity.test.mjs`
- `tests/launcher-workflow-routing.test.mjs`
