import { getRepos } from '~~/server/utils/repos'

export default defineEventHandler(async () => {
  return await getRepos()
})
