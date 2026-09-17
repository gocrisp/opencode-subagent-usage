// Subagent usage in the session sidebar.
//
// Written in plain JS on purpose. opencode loads published plugins from inside
// node_modules, and its bundled Bun runtime does not apply the JSX transform
// there, so a shipped .tsx never executes. Precompiled output is required, and
// the straightforward compilers either emit the dev JSX runtime or flatten JSX
// props eagerly, which drops Solid's reactivity. So this file is the compiled
// form directly: jsx/jsxs from the production runtime, and getters on every
// prop that reads reactive state, which is what a Solid-aware compiler emits.
//
// The built-in Context widget reports only the session it is attached to, so
// anything a subagent spends is invisible. This walks the child-session tree
// (subagents and their own subagents) and shows the rolled-up spend underneath
// Context. The numbers are additive with Context, not inclusive: Context is
// this session, Subagents is everything it spawned.

import { createSignal, Show } from "solid-js"
import { jsx, jsxs } from "@opentui/solid/jsx-runtime"

const id = "subagent-usage"

const POLL_MS = 2000

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const empty = () => ({ cost: 0, tokens: 0, sessions: 0, active: 0 })

function tokensOf(session) {
  return (
    (session.tokens?.input ?? 0) +
    (session.tokens?.output ?? 0) +
    (session.tokens?.reasoning ?? 0) +
    (session.tokens?.cache?.read ?? 0) +
    (session.tokens?.cache?.write ?? 0)
  )
}

async function walk(api, sessionID, seen) {
  if (seen.has(sessionID)) return empty()
  seen.add(sessionID)

  const response = await api.client.session.children({ sessionID })
  // The SDK reports transport/HTTP failures on the response rather than
  // throwing, so surface them as an error: the caller keeps the last good
  // value instead of painting a misleading zero.
  if (response.error) throw new Error("session.children failed")
  const children = response.data ?? []

  const deeper = await Promise.all(children.map((child) => walk(api, child.id, seen)))

  const total = empty()
  children.forEach((child, index) => {
    total.cost += child.cost ?? 0
    total.tokens += tokensOf(child)
    total.sessions += 1
    if (api.state.session.status(child.id)?.type === "busy") total.active += 1

    const nested = deeper[index]
    total.cost += nested.cost
    total.tokens += nested.tokens
    total.sessions += nested.sessions
    total.active += nested.active
  })

  return total
}

const tui = async (api) => {
  const [usage, setUsage] = createSignal(empty())
  const [ready, setReady] = createSignal(false)
  let sessionID = ""

  let running = false
  let queued = false
  async function refresh() {
    if (running) {
      queued = true
      return
    }
    if (!sessionID) return
    running = true
    try {
      const target = sessionID
      const next = await walk(api, target, new Set())
      // The sidebar can switch sessions mid-walk; never paint one session's
      // usage under another.
      if (target === sessionID) {
        setUsage(next)
        setReady(true)
      } else {
        queued = true
      }
    } catch {
      // keep the last good value
    } finally {
      running = false
      if (queued) {
        queued = false
        void refresh()
      }
    }
  }

  const timer = setInterval(() => void refresh(), POLL_MS)
  const offStatus = api.event.on("session.status", () => void refresh())
  const offUpdated = api.event.on("session.updated", () => void refresh())
  api.lifecycle.onDispose(() => {
    clearInterval(timer)
    offStatus()
    offUpdated()
  })

  api.slots.register({
    order: 90,
    slots: {
      sidebar_content(_ctx, props) {
        if (props.session_id !== sessionID) {
          // Hide the previous session's figures until the new walk lands
          // rather than showing them under the wrong session.
          sessionID = props.session_id
          setReady(false)
        }
        void refresh()

        return jsxs(Show, {
          get when() {
            return ready() && usage().sessions > 0
          },
          get children() {
            return jsxs("box", {
              children: [
                jsx("text", {
                  get fg() {
                    return api.theme.current.text
                  },
                  get children() {
                    return jsx("b", {
                      get children() {
                        return "Subagents"
                      },
                    })
                  },
                }),
                jsx("text", {
                  get fg() {
                    return api.theme.current.textMuted
                  },
                  get children() {
                    const current = usage()
                    const plural = current.sessions === 1 ? "session" : "sessions"
                    const runningText = current.active > 0 ? ` · ${current.active} running` : ""
                    return `${current.sessions} ${plural}${runningText}`
                  },
                }),
                jsx("text", {
                  get fg() {
                    return api.theme.current.textMuted
                  },
                  get children() {
                    return `${money.format(usage().cost)} spent`
                  },
                }),
                jsx("text", {
                  get fg() {
                    return api.theme.current.textMuted
                  },
                  get children() {
                    return `${usage().tokens.toLocaleString()} tokens`
                  },
                }),
              ],
            })
          },
        })
      },
    },
  })
}

export default { id, tui }
