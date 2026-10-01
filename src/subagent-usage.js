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
// (subagents and their own subagents) and shows the rolled-up spend above
// the built-in sidebar content. The numbers are additive, not inclusive: Context is
// this session, Subagents is everything it spawned.

import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { jsx, jsxs } from "@opentui/solid/jsx-runtime"
import { empty, trackUsage } from "./usage.js"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function SubagentUsage(context, props) {
  const [usage, setUsage] = createSignal(empty())
  const [ready, setReady] = createSignal(false)
  const tracker = trackUsage(context, (next) => {
    setUsage(next)
    setReady(true)
  }, () => setReady(false))
  createEffect(() => tracker.select(props.sessionID))
  onCleanup(() => tracker.dispose())

  return jsx(Show, {
    get when() {
      return ready() && usage().sessions > 0
    },
    get children() {
      return jsxs("box", {
        children: [
          jsx("text", {
            get fg() {
              return context.theme.text.base
            },
            children: jsx("b", { children: "Subagents" }),
          }),
          jsx("text", {
            get fg() {
              return context.theme.text.muted
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
              return context.theme.text.muted
            },
            get children() {
              return `${money.format(usage().cost)} spent`
            },
          }),
          jsx("text", {
            get fg() {
              return context.theme.text.muted
            },
            get children() {
              return `${usage().tokens.toLocaleString()} tokens`
            },
          }),
        ],
      })
    },
  })
}

export default Plugin.define({
  id: "subagent-usage",
  setup(context) {
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => SubagentUsage(context, props),
    })
  },
})
