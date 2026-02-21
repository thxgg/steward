import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UiOptions {
  preview: boolean
  port?: number
  host?: string
}

const require = createRequire(import.meta.url)

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

function resolveNuxtEntrypoint(): string {
  const packageJsonPath = require.resolve('nuxt/package.json', { paths: [packageRoot] })
  return join(dirname(packageJsonPath), 'bin', 'nuxt.mjs')
}

export async function runUi(options: UiOptions): Promise<number> {
  const script = options.preview ? 'preview' : 'dev'
  const args = [resolveNuxtEntrypoint(), script]

  if (options.port !== undefined || options.host) {
    if (options.port !== undefined) {
      args.push('--port', String(options.port))
    }

    if (options.host) {
      args.push('--host', options.host)
    }
  }

  const child = spawn(process.execPath, args, {
    cwd: packageRoot,
    stdio: 'inherit',
    env: process.env
  })

  return await new Promise<number>((resolveExit, reject) => {
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal)
      }
    }

    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)

    child.on('error', (error) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      reject(error)
    })

    child.on('exit', (code, signal) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)

      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      resolveExit(code ?? 0)
    })
  })
}
