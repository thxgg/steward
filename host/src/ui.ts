import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UiOptions {
  preview: boolean
  port?: number
  host?: string
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runUi(options: UiOptions): Promise<number> {
  const script = options.preview ? 'preview' : 'dev'
  const args = ['run', script]

  if (options.port !== undefined || options.host) {
    args.push('--')

    if (options.port !== undefined) {
      args.push('--port', String(options.port))
    }

    if (options.host) {
      args.push('--host', options.host)
    }
  }

  const child = spawn('bun', args, {
    cwd: projectRoot,
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
