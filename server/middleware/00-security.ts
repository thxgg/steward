function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) {
    return null
  }

  const trimmed = address.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('::ffff:')) {
    return trimmed.substring('::ffff:'.length)
  }

  return trimmed
}

function isDevRuntime(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase()
  if (nodeEnv === 'development') {
    return true
  }

  const nuxtDev = process.env.NUXT_DEV?.trim().toLowerCase()
  return nuxtDev === '1' || nuxtDev === 'true'
}

function isLoopbackAddress(address: string | null | undefined): boolean {
  const normalized = normalizeAddress(address)
  return normalized === '::1' || Boolean(normalized && normalized.startsWith('127.'))
}

export default defineEventHandler((event) => {
  if (isDevRuntime()) {
    return
  }

  const remoteAddress = event.node.req.socket.remoteAddress
  const isLocalClient = isLoopbackAddress(remoteAddress)

  if (!isLocalClient) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Remote access disabled',
      message: 'Steward only accepts local loopback requests.'
    })
  }
})
