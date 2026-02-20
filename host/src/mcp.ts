import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { execute, ExecutionError } from './executor'

function formatError(error: unknown): string {
  if (error instanceof ExecutionError) {
    return error.stackTrace
      ? `${error.message}\n\n${error.stackTrace}`
      : error.message
  }

  if (error instanceof Error) {
    return error.stack
      ? `${error.message}\n\n${error.stack}`
      : error.message
  }

  return String(error)
}

function serializeResult(result: unknown): string {
  if (result === undefined) {
    return 'undefined'
  }

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'prd',
    version: '0.1.0'
  })

  server.tool(
    'execute',
    'Run codemode JavaScript with repos, prds, git, and state APIs.',
    {
      code: z.string().min(1)
    },
    async ({ code }) => {
      try {
        const result = await execute(code)
        return {
          content: [
            {
              type: 'text',
              text: serializeResult(result)
            }
          ]
        }
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: formatError(error)
            }
          ]
        }
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
