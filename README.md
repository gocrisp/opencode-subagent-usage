# opencode-subagent-usage

A TUI sidebar widget for [opencode](https://opencode.ai) that shows the rolled-up
cost and token usage of the **subagent (child) sessions** a session spawned.

opencode's built-in **Context** block only reports the session it is attached to.
Anything a subagent spends never appears there, so on subagent-heavy work the
number you see can be a small fraction of what was actually billed.

```
Subagents                  <- this plugin
42 sessions · 3 running
$3.80 spent
188,204,551 tokens
Context                    <- built-in
96,410 tokens
48% used
$0.90 spent
```

In that example the session's real total was about $4.70. The built-in sidebar
showed $0.90 on its own. Real numbers vary with how much a workflow fans out;
the point is that the difference is invisible without this.

## Install

For **OpenCode V2**, add the package to the `plugins` array in
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-subagent-usage"]
}
```

Preserve any existing settings and plugin entries. Restart the TUI afterwards.
CLI configuration is global in V2; there is no project-local `cli.json`.

This is a CLI-only package: configure it in `cli.json`, not `opencode.json`.
It runs in your terminal even when connected to a remote OpenCode server.

### Upgrading from V1

This implementation targets V2 only. OpenCode can migrate supported global
`tui.json` settings when `cli.json` is absent, but V1 plugin code itself is not
compatible with V2. Verify that this package appears in `cli.json` under
`plugins`, replacing any explicit pin to the V1 release. Keep using package
version `0.1.1` if you still run OpenCode V1.

## What it shows

- **sessions** - number of child sessions, counted recursively (subagents and
  any subagents they spawned). The line reads `N running` when one or more
  children are currently busy.
- **spent** - summed `cost` across all of those child sessions.
- **tokens** - summed input, output, reasoning, and cache read/write tokens.

The block hides itself when a session has no subagents.

The figures are **additive with Context, not inclusive**. Context is the session
you are viewing; Subagents is everything it spawned. Add them for the true
session total.

Token counts follow the same definition the built-in Context widget uses, which
includes cache reads. On long sessions cache reads usually dominate, so the
token number can look much larger than the raw conversation size.

## How it works

For the session currently displayed in the sidebar, it calls
`client.session.list({ parentID: sessionID })`, follows every pagination cursor,
sums each child's `cost` and `tokens`, then recurses into each child. Data
refreshes every 2 seconds and on V2 `session.created`, `session.deleted`,
`session.usage.updated`, and `session.status.updated` events. A `seen` set guards
against cycles and double counting.

No network calls are made beyond OpenCode's own API client, using the connected
server (local or remote). Nothing is written to disk by this plugin, and no
session data is sent to a third-party service. Requests are cancelled when the
sidebar changes sessions or unmounts; failed refreshes keep the last good totals.

### Why the source is plain JS

`src/subagent-usage.js` is hand-written, not compiled from JSX, and that is
deliberate. opencode loads published plugins from inside `node_modules`, and its
bundled Bun runtime does not apply the JSX transform to files there, so a
shipped `.tsx` is never executed - it fails silently and the plugin simply never
appears. Building the JSX ahead of time does not solve it either: the common
compilers either emit the *dev* JSX runtime, or flatten JSX props eagerly and
drop Solid's reactivity. So the file is written directly in the shape a
Solid-aware compiler would produce: `jsx`/`jsxs` from the production runtime,
with getters on every prop that reads reactive state.

The practical consequence is that this package has no build step and no
UI dependencies other than the `solid-js` and `@opentui/solid` the host
already provides. `@opencode/plugin` supplies the V2 plugin definition API.

## Requirements

- OpenCode `>= 2.0.16 < 3` with its terminal client
- Host-provided OpenTUI `>= 0.5.8` and Solid `^1.9.0`
- A model provider that reports cost, for the `spent` figure to be meaningful

## Tuning

In the source:

- `POLL_MS` in `src/usage.js` - refresh interval, default `2000`
- `prepend: "sidebar.content"` in `src/subagent-usage.js` - places the block
  before the built-in sidebar content. V2 uses named slot placement rather than
  V1's numeric slot order.

## Development

For a local checkout, add its absolute directory path to `plugins` in
`cli.json`. The root `tui.js` is required for OpenCode's local-directory loader;
the package's `./tui` export alone only covers loading by package name.

```sh
npm install
npm run check
npm test
npm run test:tui # requires Bun >= 1.3; renders with OpenTUI's test renderer
```

Tests cover paginated recursive totals, cycle protection, V2 event refreshes,
polling, API failures, session-switch races, and cleanup. The TUI smoke test
also checks the package entrypoint, real rendering, reactive session switching,
and component cleanup.

The Subagents figures are descendants of the session being viewed. To see a
subagent's spend here, view its parent session; a child with no subagents of its
own does not show the block.

## Notes

- Costs come from opencode's own session records. A sum computed against the
  raw database can differ slightly (well under a percent) because the two are
  read at different moments.
- If you want the upstream fix rather than a plugin, see
  [anomalyco/opencode#45417](https://github.com/anomalyco/opencode/issues/45417)
  (session cost excludes subagent cost) and
  [#47822](https://github.com/anomalyco/opencode/issues/47822) /
  [#48548](https://github.com/anomalyco/opencode/issues/48548).

## Not affiliated

This project is not built by the opencode team and is not affiliated with it in
any way. "opencode" is used only to describe what it plugs into.

## License

MIT
