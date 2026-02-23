import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { assertSqliteRuntimeSupport } from '../../server/utils/db.js'
import { execute, type ExecutionEnvelope } from './executor.js'
import { getExecuteToolDescription } from './help.js'

function serializeEnvelope(envelope: ExecutionEnvelope): string {
  try {
    return JSON.stringify(envelope, null, 2)
  } catch {
    const fallback: ExecutionEnvelope = {
      ok: false,
      result: null,
      logs: [],
      error: {
        code: 'SERIALIZATION_ERROR',
        message: 'Failed to serialize execution envelope'
      },
      meta: {
        timeoutMs: 30_000,
        durationMs: 0,
        truncatedResult: false,
        truncatedLogs: false,
        resultWasUndefined: false
      }
    }

    return JSON.stringify(fallback, null, 2)
  }
}

function buildUnexpectedErrorEnvelope(error: unknown): ExecutionEnvelope {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  return {
    ok: false,
    result: null,
    logs: [],
    error: {
      code: 'MCP_EXECUTION_FAILURE',
      message,
      ...(stack && { stack })
    },
    meta: {
      timeoutMs: 30_000,
      durationMs: 0,
      truncatedResult: false,
      truncatedLogs: false,
      resultWasUndefined: false
    }
  }
}

export async function runMcpServer(): Promise<void> {
  await assertSqliteRuntimeSupport()

  const server = new McpServer({
    name: 'steward',
    version: '0.1.0'
  })

  server.tool(
    'execute',
    getExecuteToolDescription(),
    {
      code: z.string().optional()
    },
    async ({ code }) => {
      try {
        const envelope = await execute(code || '')
        return {
          isError: !envelope.ok,
          content: [
            {
              type: 'text',
              text: serializeEnvelope(envelope)
            }
          ]
        }
      } catch (error) {
        const envelope = buildUnexpectedErrorEnvelope(error)

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: serializeEnvelope(envelope)
            }
          ]
        }
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
