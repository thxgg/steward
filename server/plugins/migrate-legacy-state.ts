import { getRepos } from '~~/server/utils/repos'
import { migrateLegacyStateForRepo } from '~~/server/utils/prd-state'

export default defineNitroPlugin((nitroApp) => {
  // Run on startup
  nitroApp.hooks.hook('ready' as any, async () => {
    try {
      const repos = await getRepos()
      for (const repo of repos) {
        // Run migration in the background
        migrateLegacyStateForRepo(repo).catch(err => {
          console.error(`Failed to migrate legacy state for repo ${repo.name}:`, err)
        })
      }
    } catch (err) {
      console.error('Failed to run startup migration:', err)
    }
  })
})
