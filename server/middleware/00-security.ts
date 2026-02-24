import { timingSafeEqual } from 'node:crypto'

const TOKEN_COOKIE_NAME = 'steward_api_token'

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

function isLoopbackAddress(address: string | null | undefined): boolean {
  const normalized = normalizeAddress(address)
  return normalized === '::1' || Boolean(normalized && normalized.startsWith('127.'))
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null
  }

  for (const segment of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = segment.trim().split('=')
    if (rawName !== name) {
      continue
    }

    return decodeURIComponent(rawValue.join('='))
  }

  return null
}

function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null
  }

  const [scheme, value] = headerValue.split(/\s+/, 2)
  if (!scheme || !value || scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return value.trim() || null
}

function safeTokenEquals(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

export default defineEventHandler((event) => {
  const requestPath = getRequestURL(event).pathname
  const isApiRequest = requestPath.startsWith('/api/')
  const allowRemote = process.env.STEWARD_ALLOW_REMOTE === '1'
  const expectedToken = process.env.STEWARD_API_TOKEN?.trim() || null
  const remoteAddress = event.node.req.socket.remoteAddress
  const isLocalClient = isLoopbackAddress(remoteAddress)

  if (!isLocalClient && !allowRemote) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Remote access disabled',
      message: 'Steward only accepts local requests by default. Set STEWARD_ALLOW_REMOTE=1 to opt in.'
    })
  }

  if (!expectedToken) {
    return
  }

  const query = getQuery(event)
  const queryToken = typeof query.token === 'string' && query.token.trim().length > 0
    ? query.token.trim()
    : null

  if (queryToken && safeTokenEquals(queryToken, expectedToken)) {
    setCookie(event, TOKEN_COOKIE_NAME, expectedToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    })
  }

  if (!isApiRequest || isLocalClient) {
    return
  }

  const headerToken = readBearerToken(getHeader(event, 'authorization') || undefined)
    || (getHeader(event, 'x-steward-token') || null)
  const cookieToken = readCookie(getHeader(event, 'cookie') || undefined, TOKEN_COOKIE_NAME)
  const presentedToken = (headerToken || cookieToken || queryToken || '').trim()

  if (!presentedToken || !safeTokenEquals(presentedToken, expectedToken)) {
    setHeader(event, 'WWW-Authenticate', 'Bearer realm="steward"')
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'A valid Steward API token is required for remote API access.'
    })
  }
})
