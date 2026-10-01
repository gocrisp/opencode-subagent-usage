import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { test } from "node:test"

test("local directory entrypoint exists and is shipped as the package TUI entrypoint", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.exports["./tui"].import, "./tui.js")
  assert.ok(pkg.files.includes("tui.js"))
  assert.ok(existsSync(new URL("../tui.js", import.meta.url)))
  assert.match(readFileSync(new URL("../tui.js", import.meta.url), "utf8"), /export \{ default \} from "\.\/src\/subagent-usage\.js"/)
})
