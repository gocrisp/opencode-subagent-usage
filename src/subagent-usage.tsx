/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, Show } from "solid-js"

// Subagent usage in the session sidebar.
//
// The built-in Context widget reports only the session it is attached to, so
// anything a subagent spends is invisible: for subagent-heavy sessions most of
// the real cost never appears. This walks the child-session tree (subagents and
// their own subagents) and shows the rolled-up spend underneath Context.
//
// The numbers are additive with Context, not inclusive: Context is this
// session's own usage, Subagents is everything it spawned.

const id = "subagent-usage"

const POLL_MS = 2000

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type Usage = {
  cost: number
  tokens: number
  sessions: number
  active: number
}

const empty = (): Usage => ({ cost: 0, tokens: 0, sessions: 0, active: 0 })

async function walk(api: TuiPluginApi, sessionID: string, seen: Set<string>): Promise<Usage> {
  if (seen.has(sessionID)) return empty()
  seen.add(sessionID)

  const response = await api.client.session.children({ sessionID })
  const total = empty()

  for (const child of response.data ?? []) {
    total.cost += child.cost ?? 0
    total.tokens +=
      (child.tokens?.input ?? 0) +
      (child.tokens?.output ?? 0) +
      (child.tokens?.reasoning ?? 0) +
      (child.tokens?.cache?.read ?? 0) +
      (child.tokens?.cache?.write ?? 0)
    total.sessions += 1
    if (api.state.session.status(child.id)?.type === "busy") total.active += 1

    const deeper = await walk(api, child.id, seen)
    total.cost += deeper.cost
    total.tokens += deeper.tokens
    total.sessions += deeper.sessions
    total.active += deeper.active
  }

  return total
}

// Pure component: no timers, no subscriptions, no async. The plugin owns the
// data so the slot registry can re-invoke this freely.
function View(props: { api: TuiPluginApi; usage: () => Usage; ready: () => boolean }) {
  const theme = () => props.api.theme.current
  const usage = () => props.usage()

  return (
    <Show when={props.ready() && usage().sessions > 0}>
      <box>
        <text fg={theme().text}>
          <b>Subagents</b>
        </text>
        <text fg={theme().textMuted}>
          {usage().sessions} {usage().sessions === 1 ? "session" : "sessions"}
          {usage().active > 0 ? ` · ${usage().active} running` : ""}
        </text>
        <text fg={theme().textMuted}>{money.format(usage().cost)} spent</text>
        <text fg={theme().textMuted}>{usage().tokens.toLocaleString()} tokens</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [usage, setUsage] = createSignal<Usage>(empty())
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
        sessionID = props.session_id
        void refresh()
        return <View api={api} usage={usage} ready={ready} />
      },
    },
  })
}

export default { id, tui }
