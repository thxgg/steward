# PRD: Cross-Device State Sync with Portable Bundles

**Author:** Generated
**Date:** 2026-02-27
**Status:** Approved

## Problem Statement

Steward stores PRD state in a local SQLite database, which works well for single-device workflows but breaks down when the same user works across multiple machines. Today, state sharing is manual and error-prone because:

- repository identity is tied to local absolute paths that differ by device
- direct SQLite copy/merge can miss schema differences or conflict semantics
- there is no official, safe workflow for previewing and applying merges

We need a first-class sync workflow that stays local-first and offline-capable, and that can evolve into a centralized sync model later without replacing local SQLite.

## Users

### Primary Users

- Individual developers using Steward on multiple devices (for example: work laptop + home desktop)
- AI-assisted workflows that need consistent PRD progress state regardless of where work is done

### Secondary Users

- Small teams sharing PRD progress snapshots through git/cloud storage while remaining local-first

### User Stories

- As a developer, I want to export my Steward state from one device and merge it safely on another.
- As a developer, I want a dry-run merge preview before any data changes are applied.
- As a developer, I want sync to keep working offline and converge when I reconnect or import new data.

## Proposed Solution

Introduce a versioned, JSON-based bundle sync protocol and CLI workflow.

### V1 Workflow

1. `prd sync export <bundlePath> [--path-hints basename|none|absolute]` creates a versioned state bundle from local SQLite (default: `basename`).
2. `prd sync inspect <bundlePath>` prints bundle metadata and affected repos/slugs.
3. `prd sync merge <bundlePath>` previews merge changes and conflicts (dry-run by default).
4. `prd sync merge <bundlePath> --apply` applies the merge in one transaction with automatic backup.

### Core V1 Design Decisions

- **Protocol-first:** bundle format is treated as a stable sync protocol (`formatVersion`) rather than a one-off export artifact.
- **Stable repo identity:** each repo has a device-agnostic `repoSyncKey`; paths are hints, not identity.
- **Path privacy by default:** export uses basename-only path hints unless full paths are explicitly requested.
- **Per-field merge clocks:** `tasks`, `progress`, and `notes` each have their own update clock and deterministic hash tie-breakers.
- **Safety by default:** merge runs in dry-run mode unless `--apply` is provided, with unresolved mapping reporting and auto-backup before writes.
- **Offline-first:** local SQLite remains source of truth; bundle exchange is transport-agnostic.

### Future Hosted Compatibility

The same bundle protocol and merge logic should be reusable when adding a small hosted sync service later:

- local devices continue writing to local SQLite offline
- reconnect flow performs push/pull with bundle-shaped payloads
- local merge engine remains the convergence mechanism

## Scope

### In Scope (V1)

- New CLI sync commands: export, inspect, merge (dry-run/apply)
- Versioned bundle schema containing repos, PRD state rows, archive rows, and metadata
- Path hint redaction defaults (`basename` default, with opt-in alternatives)
- Repo identity mapping via `repoSyncKey` plus fallback matching and explicit user mapping
- Per-field clocks and field-level deterministic conflict resolution (`tasks`/`progress`/`notes`)
- Transactional merge with idempotency checks and integrity verification
- Merge audit log and idempotent bundle application tracking
- Documentation for cross-device sync workflow and recovery steps

### Out of Scope (V1)

- Real-time background sync
- Hosted service implementation
- Full CRDT/oplog conflict model
- Tombstone-based delete propagation and cross-device hard-delete semantics
- End-to-end encryption and account/auth flows

## Technical Considerations

### Data Model

- Add `repo_sync_meta` table: map local `repo_id` to stable `repoSyncKey` and fingerprint metadata.
- Add `sync_bundle_log` table: store applied bundle IDs for dedupe and auditability.
- Add `app_meta` entry for stable local `sync:device-id`.
- Add per-field clock columns on `prd_states`: `tasks_updated_at`, `progress_updated_at`, `notes_updated_at`.
- Backfill per-field clocks for legacy rows from `updated_at` during migration.
- Keep existing `repos`, `prd_states`, and `prd_archives` as primary state tables.

### Bundle Schema (V1)

Bundle envelope should include:

- `type`, `formatVersion`, `bundleId`, `createdAt`, `sourceDeviceId`, `stewardVersion`
- `repos[]` with `repoSyncKey`, `name`, `pathHint` (basename by default), `fingerprint`, `fingerprintKind`
- `states[]` with `repoSyncKey`, `slug`, `tasks`, `progress`, `notes`, and per-field metadata:
  - `clocks.tasksUpdatedAt`, `clocks.progressUpdatedAt`, `clocks.notesUpdatedAt`
  - `hashes.tasksHash`, `hashes.progressHash`, `hashes.notesHash`
- `archives[]` with `repoSyncKey`, `slug`, `archivedAt`

### Repo Mapping Algorithm

Incoming bundle repo resolution order:

1. explicit `--map` override
2. exact `repoSyncKey` match
3. unique fingerprint match
4. unresolved (skip + report)

### Merge Semantics (V1)

- Upsert on logical key `(repoSyncKey, slug)` after local repo resolution.
- Merge each field independently using per-field clocks (`tasks`, `progress`, `notes`).
- Winner selection per field: newer field clock wins; equal clock uses deterministic field hash tie-break.
- Explicit field clearing is supported when incoming value is `null` with a newer field clock.
- Archives merge by latest `archivedAt` timestamp.
- Missing incoming rows are treated as no-op (additive sync only in v1).

### Safety and Reliability

- `--dry-run` returns exact operations and unresolved items without writing.
- `--apply` requires transactional merge and automatic backup.
- Re-applying the same bundle should be idempotent.
- Post-apply integrity check should run before reporting success.
- Backup retention defaults: keep 30 days and at most 20 backup files.
- Sync log retention defaults: keep 180 days and at most 10,000 apply records.

### Compatibility with Future Centralized Sync

- Keep merge engine independent from transport (file now, HTTP later).
- Keep bundle versioning strict so server/client can negotiate formats.
- Preserve local-first write path so offline behavior is unchanged.

## Success Criteria

- Users can move state between two devices with a documented command flow and no manual SQL.
- Dry-run accurately predicts apply results (insert/update/skip/unresolved counts).
- Re-importing the same bundle makes zero additional changes (idempotent behavior).
- Cross-device path differences do not block merge when `repoSyncKey` or mapping is available.
- Local database integrity passes after merge.
- Protocol and merge logic remain reusable for future hosted sync transport.

## Risks

- **Equal-clock conflicts:** if two devices produce identical field clocks with different content, deterministic hash tie-break may not match user intent.
- **Repo identity ambiguity:** weak fingerprints can mis-map repos in edge cases.
- **Privacy leakage:** path hints in bundles may expose local filesystem details if shared carelessly.
- **Schema drift:** older DBs may miss expected tables and require defensive creation/migration.
- **Large bundle performance:** export/import may become slow for very large state sets.

## Resolved Product Decisions

- Path hints default to `basename`; full absolute hints require explicit opt-in.
- Merge defaults to dry-run; writes require explicit `--apply`.
- Per-field clocks are in v1 (not deferred), with deterministic field hash tie-break.
- Retention defaults are accepted: backups (30 days, max 20) and sync apply logs (180 days, max 10,000 rows).
