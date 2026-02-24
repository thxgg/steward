import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UiOptions {
  preview: boolean
  port?: number
  host?: string
}

const DEFAULT_UI_HOST = '127.0.0.1'

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase()
  return normalizedHost === '127.0.0.1'
    || normalizedHost === 'localhost'
    || normalizedHost === '::1'
}

function findPackageRoot(startDir: string): string {
  let currentDir = startDir

  while (true) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      throw new Error('Unable to locate package root from current runtime path')
    }

    currentDir = parentDir
  }
}

const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)))

export async function runUi(options: UiOptions): Promise<number> {
  const serverEntrypoint = join(packageRoot, '.output', 'server', 'index.mjs')
  if (!existsSync(serverEntrypoint)) {
    throw new Error(
      'Steward UI build artifacts were not found. In a source checkout, run `npm run build` (or `npm run dev` for development).'
    )
  }

  if (options.preview) {
    console.warn('[steward] `--preview` is deprecated and ignored. Running prebuilt UI server.')
  }

  const args = [serverEntrypoint]
  const env = { ...process.env }
  const hostFromEnv = env.NITRO_HOST || env.HOST
  const requestedHost = (options.host || hostFromEnv || DEFAULT_UI_HOST).trim()

  if (!isLoopbackHost(requestedHost)) {
    throw new Error(
      `Refusing to bind UI to non-loopback host "${requestedHost}". Steward only supports loopback hosts.`
    )
  }

  env.NODE_ENV = env.NODE_ENV || 'production'

  if (options.port !== undefined) {
    const port = String(options.port)
    env.PORT = port
    env.NITRO_PORT = port
  }

  env.HOST = requestedHost
  env.NITRO_HOST = requestedHost

  const child = spawn(process.execPath, args, {
    cwd: packageRoot,
    stdio: 'inherit',
    env
  })

  return await new Promise<number>((resolveExit, reject) => {
    const signalGracePeriodMs = 2000
    let forceKillTimer: NodeJS.Timeout | null = null
    let signalCount = 0
    let childExited = false

    const clearForceKillTimer = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer)
        forceKillTimer = null
      }
    }

    const cleanup = () => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      clearForceKillTimer()
    }

    const forceKill = () => {
      if (!childExited && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }

    const forwardSignal = (signal: NodeJS.Signals) => {
      if (childExited) {
        return
      }

      signalCount += 1

      if (signalCount > 1) {
        forceKill()
        return
      }

      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal)
      }

      clearForceKillTimer()
      forceKillTimer = setTimeout(forceKill, signalGracePeriodMs)
    }

    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)

    child.on('error', (error) => {
      cleanup()
      reject(error)
    })

    child.on('exit', (code, signal) => {
      childExited = true
      cleanup()

      if (signal) {
        if (signal === 'SIGINT') {
          resolveExit(130)
          return
        }

        if (signal === 'SIGTERM') {
          resolveExit(143)
          return
        }

        resolveExit(1)
        return
      }

      resolveExit(code ?? 0)
    })
  })
}
