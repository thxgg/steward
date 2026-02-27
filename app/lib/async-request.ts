export interface LatestRequestTicket {
  signal: AbortSignal
  isCurrent: () => boolean
}

export interface LatestRequestManager {
  begin: () => LatestRequestTicket
  clear: (ticket: LatestRequestTicket) => void
  cancel: () => void
}

interface InternalTicket extends LatestRequestTicket {
  controller: AbortController
}

export function createLatestRequestManager(): LatestRequestManager {
  let activeTicket: InternalTicket | null = null

  function begin(): LatestRequestTicket {
    activeTicket?.controller.abort()

    const controller = new AbortController()
    const ticket: InternalTicket = {
      controller,
      signal: controller.signal,
      isCurrent: () => activeTicket === ticket && !controller.signal.aborted
    }

    activeTicket = ticket
    return ticket
  }

  function clear(ticket: LatestRequestTicket) {
    if (activeTicket === ticket) {
      activeTicket = null
    }
  }

  function cancel() {
    activeTicket?.controller.abort()
    activeTicket = null
  }

  return {
    begin,
    clear,
    cancel
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const abortLike = error as {
    name?: string
    message?: string
    cause?: { name?: string; message?: string }
  }

  if (abortLike.name === 'AbortError' || abortLike.cause?.name === 'AbortError') {
    return true
  }

  const message = abortLike.message || abortLike.cause?.message
  return typeof message === 'string' && message.toLowerCase().includes('aborted')
}
