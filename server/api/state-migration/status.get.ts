import { getStateMigrationStatus, startStateMigration } from '~~/server/utils/state-migration'

export default defineEventHandler((event) => {
  void startStateMigration()

  const status = getStateMigrationStatus()

  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate')

  return status
})
