// Run with Bun and Solid's browser condition, as used by the terminal host.
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import plugin from "opencode-subagent-usage/tui"

const [sessionID, setSessionID] = createSignal("root")
const listeners = new Map()
let claim
let unregistered = false
let cost = 1.25
let status = "running"
const context = {
  client: { session: { async list({ parentID }) {
    return {
      data: parentID === "root" ? [{
        id: "child",
        cost,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      }] : [],
      cursor: { next: null },
    }
  } } },
  data: {
    session: { status: () => status },
    on(type, callback) {
      listeners.set(type, callback)
      return () => listeners.delete(type)
    },
  },
  theme: { text: { base: "#ffffff", muted: "#888888" } },
  ui: { slot(value) {
    claim = value
    return () => { unregistered = true }
  } },
}

assert.equal(plugin.id, "subagent-usage")
const cleanup = plugin.setup(context)
assert.equal(claim.prepend, "sidebar.content")
const view = await testRender(() => claim.render({ get sessionID() { return sessionID() } }), {
  width: 40, height: 10,
})
try {
  const frame = await view.waitForFrame((text) => text.includes("$1.25 spent"))
  assert.match(frame, /Subagents/)
  assert.match(frame, /1 session · 1 running/)
  assert.match(frame, /15 tokens/)
  cost = 2.50
  status = "idle"
  listeners.get("session.usage.updated")()
  const updated = await view.waitForFrame((text) => text.includes("$2.50 spent"))
  assert.doesNotMatch(updated, /running/)
  setSessionID("empty")
  await view.waitForFrame((text) => !text.includes("Subagents"))
  setSessionID("root")
  await view.waitForFrame((text) => text.includes("$2.50 spent"))
} finally {
  view.renderer.destroy()
  cleanup()
}
assert.equal(unregistered, true)
assert.equal(listeners.size, 0)
console.log("V2 TUI entrypoint, rendering, reactive session switching, and cleanup OK")
