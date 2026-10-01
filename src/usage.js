export const POLL_MS = 2000

export const empty = () => ({ cost: 0, tokens: 0, sessions: 0, active: 0 })

function tokensOf(session) {
  return (
    (session.tokens?.input ?? 0) +
    (session.tokens?.output ?? 0) +
    (session.tokens?.reasoning ?? 0) +
    (session.tokens?.cache?.read ?? 0) +
    (session.tokens?.cache?.write ?? 0)
  )
}

// V2 returns a SessionsResponse directly and rejects on HTTP/transport errors.
// Follow every page: session.list defaults to only the newest 50 sessions.
export async function walk(client, status, sessionID, signal, seen = new Set()) {
  seen.add(sessionID)
  const total = empty()
  let cursor
  do {
    signal?.throwIfAborted()
    const page = await client.session.list({ parentID: sessionID, cursor }, { signal })
    signal?.throwIfAborted()
    const totals = await Promise.all(page.data.map(async (child) => {
      // Guard both traversal and accounting against cycles or duplicate records.
      if (seen.has(child.id)) return empty()
      seen.add(child.id)
      const nested = await walk(client, status, child.id, signal, seen)
      return {
        cost: (child.cost ?? 0) + nested.cost,
        tokens: tokensOf(child) + nested.tokens,
        sessions: 1 + nested.sessions,
        active: (status(child.id) === "running" ? 1 : 0) + nested.active,
      }
    }))
    for (const nested of totals) {
      total.cost += nested.cost
      total.tokens += nested.tokens
      total.sessions += nested.sessions
      total.active += nested.active
    }
    cursor = page.cursor.next
  } while (cursor)
  return total
}

// Each mounted sidebar owns its tracker, so tabs never share displayed totals.
export function trackUsage(context, update, reset) {
  let sessionID = ""
  let generation = 0
  let disposed = false
  let running = false
  let queued = false
  let controller

  async function refresh() {
    if (disposed || !sessionID) return
    if (running) {
      queued = true
      return
    }
    running = true
    const target = generation
    controller = new AbortController()
    try {
      const next = await walk(context.client, (id) => context.data.session.status(id), sessionID, controller.signal)
      if (!disposed && target === generation) update(next)
    } catch {
      // Preserve the last good value; do not turn an API failure into zero usage.
      controller.abort()
    } finally {
      running = false
      if (queued && !disposed) {
        queued = false
        void refresh()
      }
    }
  }

  const timer = setInterval(() => void refresh(), POLL_MS)
  const off = [
    "session.created",
    "session.deleted",
    "session.usage.updated",
    "session.status.updated",
  ].map((type) => context.data.on(type, () => void refresh()))

  return {
    select(id) {
      if (disposed || id === sessionID) return
      sessionID = id
      generation += 1
      reset()
      controller?.abort()
      void refresh()
    },
    dispose() {
      disposed = true
      clearInterval(timer)
      off.forEach((unsubscribe) => unsubscribe())
      controller?.abort()
    },
  }
}
