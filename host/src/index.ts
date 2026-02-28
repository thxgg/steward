import { runMcpServer } from './mcp.js'
import { runSync } from './sync.js'
import { runUi } from './ui.js'
import { bootstrapLauncher } from './launcher/bootstrap.js'

type UiCliOptions = {
  preview: boolean
  port?: number
  host?: string
}

type LauncherCliOptions = UiCliOptions & {
  repo?: string
  prd?: string
}

function printUsage(): void {
  console.log(`prd - Steward CLI

Usage:
  prd ui [--preview] [--port <port>] [--host <host>]
  prd launcher [--repo <repo-id-or-path>] [--prd <slug>] [--port <port>] [--host <host>]
  prd sync <subcommand> [options]
  prd mcp

Commands:
  ui         Launch the prebuilt PRD web UI server
  launcher   Launch UI with desktop host workspace bootstrap context
  sync       Export/inspect/merge sync bundles
  mcp        Start MCP server over stdio (codemode)

Options:
  --preview      Deprecated; ignored (kept for compatibility)
  --repo <value> Repo id or absolute path for launcher mode
  --prd <slug>   PRD slug override for launcher mode
  --port <port>  Port for ui mode
  --host <host>  Host for ui mode
  -h, --help     Show this help message
`)
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${value}`)
  }

  return parsed
}

function parseUiArgs(args: string[]): UiCliOptions {
  const options: UiCliOptions = { preview: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--preview') {
      options.preview = true
      continue
    }

    if (arg === '--port') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--port requires a value')
      }

      options.port = parsePort(next)
      i += 1
      continue
    }

    if (arg === '--host') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--host requires a value')
      }

      options.host = next
      i += 1
      continue
    }

    throw new Error(`Unknown option for ui: ${arg}`)
  }

  return options
}

function parseLauncherArgs(args: string[]): LauncherCliOptions {
  const options: LauncherCliOptions = { preview: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--preview') {
      options.preview = true
      continue
    }

    if (arg === '--port') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--port requires a value')
      }

      options.port = parsePort(next)
      i += 1
      continue
    }

    if (arg === '--host') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--host requires a value')
      }

      options.host = next
      i += 1
      continue
    }

    if (arg === '--repo') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--repo requires a value')
      }

      options.repo = next
      i += 1
      continue
    }

    if (arg === '--prd') {
      const next = args[i + 1]
      if (!next) {
        throw new Error('--prd requires a value')
      }

      options.prd = next
      i += 1
      continue
    }

    throw new Error(`Unknown option for launcher: ${arg}`)
  }

  return options
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv

  if (!command || command === '-h' || command === '--help') {
    printUsage()
    return
  }

  if (command === 'mcp') {
    if (rest.includes('-h') || rest.includes('--help')) {
      printUsage()
      return
    }

    if (rest.length > 0) {
      throw new Error(`Unexpected arguments for mcp: ${rest.join(' ')}`)
    }

    await runMcpServer()
    return
  }

  if (command === 'ui') {
    if (rest.includes('-h') || rest.includes('--help')) {
      printUsage()
      return
    }

    const options = parseUiArgs(rest)
    const exitCode = await runUi(options)
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
    return
  }

  if (command === 'sync') {
    const exitCode = await runSync(rest)
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
    return
  }

  if (command === 'launcher') {
    if (rest.includes('-h') || rest.includes('--help')) {
      printUsage()
      return
    }

    const options = parseLauncherArgs(rest)
    const bootstrap = await bootstrapLauncher({
      repoHint: options.repo,
      prdSlug: options.prd
    })

    for (const line of bootstrap.logLines) {
      console.log(`[steward] ${line}`)
    }

    try {
      const exitCode = await runUi(
        {
          preview: options.preview,
          port: options.port,
          host: options.host
        },
        bootstrap.runtime,
        bootstrap.control
      )

      if (exitCode !== 0) {
        process.exitCode = exitCode
      }
    } finally {
      await bootstrap.shutdown()
    }

    return
  }

  throw new Error(`Unknown command: ${command}`)
}

if (import.meta.main) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${message}`)
    process.exit(1)
  })
}
