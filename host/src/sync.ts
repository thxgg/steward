import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  buildSyncBundle,
  serializeSyncBundle,
  type SyncPathHintsMode
} from '../../server/utils/sync-export.js'
import { executeSyncMergeJson } from '../../server/utils/sync-apply.js'
import { inspectSyncBundleJson } from '../../server/utils/sync-inspect.js'

type SyncCommand = 'export' | 'inspect' | 'merge'

export type ParsedSyncExportArgs = {
  bundlePath: string
  pathHints: SyncPathHintsMode
}

export type ParsedSyncInspectArgs = {
  bundlePath: string
}

export type ParsedSyncMergeArgs = {
  bundlePath: string
  apply: boolean
  repoMap: Record<string, string>
}

function printSyncUsage(): void {
  console.log(`Sync Usage:
  prd sync export <bundle-path> [--path-hints basename|none|absolute]
  prd sync inspect <bundle-path>
  prd sync merge <bundle-path> [--map <incomingRepoSyncKey>=<localPathOrRepoRef>] [--dry-run] [--apply]

Notes:
  - merge defaults to --dry-run when --apply is omitted
  - --map can be provided multiple times
`)
}

function resolveBundlePath(pathInput: string): string {
  return resolve(process.cwd(), pathInput)
}

function parsePathHintsMode(rawValue: string): SyncPathHintsMode {
  if (rawValue === 'basename' || rawValue === 'none' || rawValue === 'absolute') {
    return rawValue
  }

  throw new Error(`Invalid --path-hints value: ${rawValue}`)
}

function parseMapAssignment(rawValue: string): { source: string; target: string } {
  const separatorIndex = rawValue.indexOf('=')
  if (separatorIndex <= 0 || separatorIndex >= rawValue.length - 1) {
    throw new Error(`Invalid --map value: ${rawValue}. Expected <incomingRepoSyncKey>=<localPathOrRepoRef>`)
  }

  const source = rawValue.slice(0, separatorIndex).trim()
  const target = rawValue.slice(separatorIndex + 1).trim()

  if (!source || !target) {
    throw new Error(`Invalid --map value: ${rawValue}. Expected <incomingRepoSyncKey>=<localPathOrRepoRef>`)
  }

  return { source, target }
}

export function parseSyncExportArgs(args: string[]): ParsedSyncExportArgs {
  let bundlePath: string | null = null
  let pathHints: SyncPathHintsMode = 'basename'

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg) {
      continue
    }

    if (arg === '--path-hints') {
      const next = args[index + 1]
      if (!next) {
        throw new Error('--path-hints requires a value')
      }

      pathHints = parsePathHintsMode(next)
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option for sync export: ${arg}`)
    }

    if (bundlePath !== null) {
      throw new Error(`Unexpected argument for sync export: ${arg}`)
    }

    bundlePath = arg
  }

  if (!bundlePath) {
    throw new Error('sync export requires <bundle-path>')
  }

  return {
    bundlePath: resolveBundlePath(bundlePath),
    pathHints
  }
}

export function parseSyncInspectArgs(args: string[]): ParsedSyncInspectArgs {
  const [bundlePath] = args

  if (args.length !== 1 || !bundlePath || bundlePath.startsWith('--')) {
    throw new Error('sync inspect requires exactly one <bundle-path>')
  }

  return {
    bundlePath: resolveBundlePath(bundlePath)
  }
}

export function parseSyncMergeArgs(args: string[]): ParsedSyncMergeArgs {
  let bundlePath: string | null = null
  let apply = false
  let dryRun = false
  const repoMap: Record<string, string> = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg) {
      continue
    }

    if (arg === '--apply') {
      apply = true
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--map') {
      const next = args[index + 1]
      if (!next) {
        throw new Error('--map requires a value')
      }

      const { source, target } = parseMapAssignment(next)
      repoMap[source] = target
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option for sync merge: ${arg}`)
    }

    if (bundlePath !== null) {
      throw new Error(`Unexpected argument for sync merge: ${arg}`)
    }

    bundlePath = arg
  }

  if (!bundlePath) {
    throw new Error('sync merge requires <bundle-path>')
  }

  if (apply && dryRun) {
    throw new Error('Cannot use --apply and --dry-run together')
  }

  return {
    bundlePath: resolveBundlePath(bundlePath),
    apply,
    repoMap
  }
}

async function runSyncExport(args: string[]): Promise<number> {
  const parsed = parseSyncExportArgs(args)
  const bundle = await buildSyncBundle({
    pathHints: parsed.pathHints
  })

  await fs.mkdir(dirname(parsed.bundlePath), { recursive: true })
  await fs.writeFile(parsed.bundlePath, `${serializeSyncBundle(bundle)}\n`, 'utf-8')

  console.log(`[steward] Exported bundle: ${parsed.bundlePath}`)
  console.log(`[steward] Bundle ID: ${bundle.bundleId}`)
  console.log(`[steward] Rows: repos=${bundle.repos.length} states=${bundle.states.length} archives=${bundle.archives.length}`)
  return 0
}

async function runSyncInspect(args: string[]): Promise<number> {
  const parsed = parseSyncInspectArgs(args)
  const jsonPayload = await fs.readFile(parsed.bundlePath, 'utf-8')
  const inspection = inspectSyncBundleJson(jsonPayload)

  console.log(`[steward] Bundle: ${parsed.bundlePath}`)
  console.log(`[steward] ID=${inspection.bundleId} sourceDevice=${inspection.sourceDeviceId} format=v${inspection.formatVersion}`)
  console.log(`[steward] Totals: repos=${inspection.totals.repos} states=${inspection.totals.states} archives=${inspection.totals.archives}`)
  console.log(`[steward] Unknown references: states=${inspection.totals.unknownRepoStates} archives=${inspection.totals.unknownRepoArchives}`)

  for (const repo of inspection.repos) {
    const hint = repo.pathHint ? ` pathHint=${repo.pathHint}` : ''
    console.log(`[steward] Repo ${repo.repoSyncKey} (${repo.name})${hint} states=${repo.stateCount} archives=${repo.archiveCount}`)
  }

  return 0
}

async function runSyncMerge(args: string[]): Promise<number> {
  const parsed = parseSyncMergeArgs(args)
  const jsonPayload = await fs.readFile(parsed.bundlePath, 'utf-8')
  const result = await executeSyncMergeJson(jsonPayload, {
    apply: parsed.apply,
    repoMap: parsed.repoMap
  })

  const mode = result.mode === 'dry_run' ? 'dry-run' : 'apply'
  console.log(`[steward] Merge mode: ${mode}`)
  console.log(`[steward] Bundle ID: ${result.bundleId}`)
  console.log(`[steward] Repo mapping: mapped=${result.plan.summary.repos.mapped} unresolved=${result.plan.summary.repos.unresolved}`)
  console.log(`[steward] State actions: insert=${result.plan.summary.states.insert} update=${result.plan.summary.states.update} skip=${result.plan.summary.states.skip} unresolved=${result.plan.summary.states.unresolved} conflicts=${result.plan.summary.states.conflicts}`)
  console.log(`[steward] Archive actions: insert=${result.plan.summary.archives.insert} update=${result.plan.summary.archives.update} skip=${result.plan.summary.archives.skip} unresolved=${result.plan.summary.archives.unresolved}`)

  if (result.mode === 'apply') {
    if (result.alreadyApplied) {
      console.log('[steward] Bundle already applied; no changes were written.')
    } else {
      console.log(`[steward] Applied: ${result.applied ? 'yes' : 'no'}`)
      if (result.backupPath) {
        console.log(`[steward] Backup: ${result.backupPath}`)
      }
      console.log(`[steward] Retention: backupsDeleted=${result.retention.backupsDeleted} logsDeleted=${result.retention.logsDeleted}`)
    }
  } else {
    console.log('[steward] Dry-run only; re-run with --apply to write changes.')
  }

  return 0
}

export async function runSync(args: string[]): Promise<number> {
  const [subcommandRaw, ...rest] = args
  const subcommand = subcommandRaw || ''

  if (subcommand === '' || subcommand === '-h' || subcommand === '--help') {
    printSyncUsage()
    return 0
  }

  if (subcommand === 'export') {
    return await runSyncExport(rest)
  }

  if (subcommand === 'inspect') {
    return await runSyncInspect(rest)
  }

  if (subcommand === 'merge') {
    return await runSyncMerge(rest)
  }

  throw new Error(`Unknown sync subcommand: ${subcommandRaw}`)
}
