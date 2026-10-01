import assert from "node:assert/strict"
import { test } from "node:test"
import { empty, POLL_MS, trackUsage, walk } from "../src/usage.js"

const page = (data = [], next = null) => ({ data, cursor: { next } })
const flush = () => new Promise((resolve) => setImmediate(resolve))
const child = (id, cost = 1) => ({
  id,
  cost,
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
})

test("walk includes every page and descendant, excluding the parent", async () => {
  const calls = []
  const signal = new AbortController().signal
  const client = { session: { async list(input, options) {
    assert.equal(options.signal, signal)
    calls.push(input)
    if (input.parentID === "root") return input.cursor ? page([child("b", 2)]) : page([child("a")], "next")
    if (input.parentID === "a") return page([child("grandchild", 3)])
    return page()
  } } }
  assert.deepEqual(await walk(client, (id) => id === "grandchild" ? "running" : "idle", "root", signal), {
    cost: 6, tokens: 45, sessions: 3, active: 1,
  })
  assert.ok(calls.some((input) => input.parentID === "root" && input.cursor === "next"))
})

test("walk guards cycles and duplicate accounting", async () => {
  const client = { session: { async list({ parentID }) {
    return parentID === "root" ? page([child("a"), child("a"), child("root")]) : page([child("root")])
  } } }
  assert.deepEqual(await walk(client, () => "idle", "root"), { cost: 1, tokens: 15, sessions: 1, active: 0 })
})

test("walk handles empty usage and rejects failed requests", async () => {
  const client = { session: { list: async () => page() } }
  assert.deepEqual(await walk(client, () => "idle", "root"), empty())
  client.session.list = async ({ parentID }) => parentID === "root" ? page([{ id: "a" }]) : page()
  assert.deepEqual(await walk(client, () => "idle", "root"), { ...empty(), sessions: 1 })
  client.session.list = async () => { throw new Error("offline") }
  await assert.rejects(walk(client, () => "idle", "root"), /offline/)
})

function harness(t, list) {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const listeners = new Map()
  const updates = []
  let resets = 0
  const context = {
    client: { session: { list } },
    data: {
      session: { status: () => "running" },
      on(type, callback) {
        listeners.set(type, callback)
        return () => listeners.delete(type)
      },
    },
  }
  const tracker = trackUsage(context, (value) => updates.push(value), () => resets++)
  t.after(() => tracker.dispose())
  return { tracker, listeners, updates, resets: () => resets }
}

test("tracker polls, refreshes on V2 events, and keeps last good totals on failure", async (t) => {
  let cost = 1
  let failed = false
  const h = harness(t, async ({ parentID }) => {
    if (failed) throw new Error("offline")
    return parentID === "root" ? page([child("a", cost)]) : page()
  })
  h.tracker.select("root")
  await flush()
  assert.equal(h.updates.at(-1).cost, 1)
  cost = 2
  t.mock.timers.tick(POLL_MS)
  await flush()
  assert.equal(h.updates.at(-1).cost, 2)
  cost = 3
  h.listeners.get("session.usage.updated")()
  await flush()
  assert.equal(h.updates.at(-1).cost, 3)
  failed = true
  h.listeners.get("session.status.updated")()
  await flush()
  assert.equal(h.updates.length, 3)
})

test("session switching aborts old requests and discards stale results, including A-B-A", async (t) => {
  let finish
  let signal
  let calls = 0
  const h = harness(t, async ({ parentID }, options) => {
    calls++
    if (calls === 1) {
      signal = options.signal
      // Deliberately ignore abort to verify the generation guard too.
      return new Promise((resolve) => { finish = resolve })
    }
    return parentID === "a" ? page([child("new", 9)]) : page()
  })
  h.tracker.select("a")
  h.tracker.select("b")
  h.tracker.select("a")
  assert.equal(signal.aborted, true)
  finish(page([child("old", 100)]))
  await flush()
  assert.equal(h.resets(), 3)
  assert.deepEqual(h.updates.map((value) => value.cost), [9])
})

test("cleanup removes subscriptions and polling, aborts work, and prevents late updates", async (t) => {
  let finish
  let signal
  let calls = 0
  const h = harness(t, (_input, options) => {
    calls++
    signal = options.signal
    return new Promise((resolve) => { finish = resolve })
  })
  h.tracker.select("root")
  h.listeners.get("session.created")()
  h.tracker.dispose()
  assert.equal(signal.aborted, true)
  assert.equal(h.listeners.size, 0)
  finish(page())
  await flush()
  t.mock.timers.tick(POLL_MS * 2)
  h.tracker.select("other")
  assert.equal(calls, 1)
  assert.equal(h.updates.length, 0)
})
