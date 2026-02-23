import { randomUUID } from 'node:crypto'

const SERVER_INSTANCE_ID = randomUUID()
const SERVER_STARTED_AT = new Date().toISOString()

export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)

  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate')

  return {
    buildId: runtimeConfig.app.buildId,
    instanceId: SERVER_INSTANCE_ID,
    startedAt: SERVER_STARTED_AT
  }
})
