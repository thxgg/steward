import { startStateMigration } from '~~/server/utils/state-migration'

export default defineNitroPlugin(() => {
  void startStateMigration()
})
