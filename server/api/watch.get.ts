import { addChangeListener, type FileChangeEvent } from '~~/server/utils/change-events'
import { initWatcher } from '~~/server/utils/watcher'

export default defineEventHandler(async (event) => {
  // Initialize watcher if not already done
  await initWatcher()

  // Set headers for SSE
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  // Create a response stream
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connectMsg = `data: ${JSON.stringify({ type: 'connected' })}\n\n`
      controller.enqueue(new TextEncoder().encode(connectMsg))

      // Add listener for file changes
      const removeListener = addChangeListener((fileEvent: FileChangeEvent) => {
        const msg = `data: ${JSON.stringify(fileEvent)}\n\n`
        try {
          controller.enqueue(new TextEncoder().encode(msg))
        } catch {
          // Stream closed, clean up
          removeListener()
        }
      })

      // Handle client disconnect
      event.node.req.on('close', () => {
        removeListener()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })

      // Send keepalive every 30 seconds
      const keepaliveInterval = setInterval(() => {
        try {
          const ping = `: keepalive\n\n`
          controller.enqueue(new TextEncoder().encode(ping))
        } catch {
          clearInterval(keepaliveInterval)
        }
      }, 30000)

      event.node.req.on('close', () => {
        clearInterval(keepaliveInterval)
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
})
