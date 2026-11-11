# Paseo pins

A Paseo plugin that lets agents maintain useful HTTP(S) links per workspace. Users open **Pins** in the workspace header (the workspace menu on narrow layouts) and click a link to open it externally.

## Development and installation

Requires Node.js 22 or newer for development and Paseo 0.15.2 or newer on both daemon and app.

```sh
npm ci
npm run hooks:install
npm run check
paseo plugin install /absolute/path/to/paseo-pins
```

Plugins must already be enabled on the intended daemon. For a remote daemon, the source directory must exist on that machine. After editing, run `paseo plugin reload paseo-pins`. Check `paseo plugin ls` and `paseo plugin logs paseo-pins` for load errors.

One active installation per daemon is supported. Host runtime modules are development dependencies; Paseo supplies them when running the plugin.

## Code-quality checks

Run `npm run check` for the complete local gate: lint/import order, formatting, TypeScript, unused code, duplication, and the focused tests. It does not modify files and stops on the first failure. Tool versions are pinned in `package.json`; use `npm ci` to install the lockfile versions.

| Command | Checks |
| --- | --- |
| `npm run lint` | Biome recommended rules and import organization; warnings fail |
| `npm run format:check` | Biome formatting for code and JSON configuration |
| `npm run typecheck` | TypeScript with strict checking |
| `npm run knip` | Unused files, exports, and dependencies, plus unresolved imports |
| `npm run duplicates` | jscpd repeated runtime code, with a zero-percent threshold for blocks of at least 10 lines and 100 tokens |
| `npm test` | Store behavior, workspace scoping, URL validation, and agent tools |

Use `npm run format` to format files, or `npm run fix` to apply formatting, import organization, and safe lint fixes. Review the edits, then run `npm run check`.

The checks exclude canvas prototypes under `design/`. Biome includes test code and configuration but leaves the generated lockfile alone. Knip explicitly starts from Paseo's two plugin entry points and the tests; it does not treat every source file as an entry point. Duplication detection excludes tests because repeating setup and assertions can make each case easier to understand. Adjust these boundaries deliberately when adding new code locations.

Configuration: [biome.json](biome.json), [knip.json](knip.json), [.jscpd.json](.jscpd.json). Tool references: [Biome](https://biomejs.dev/reference/configuration/), [Knip](https://knip.dev/overview/configuration), [jscpd](https://jscpd.dev/start/configuration).

The repository's [.githooks/pre-commit](.githooks/pre-commit) runs `npm run check` before each commit and blocks the commit on failure. Run `npm run hooks:install` once in each clone to configure Git's local `core.hooksPath`; Git does not copy local configuration when cloning. The hook checks the working tree without formatting, staging, or stashing files. With partially staged files, ensure the staged changes match what you intend to validate.

## Agent tools

- `pins_list({})` lists the calling agent's workspace pins.
- `pins_apply({ upsert?, remove? })` atomically applies multiple changes and returns their results plus the resulting pin list.
- `pins_upsert({ key, title, url, type?, notify? })` creates or replaces a pin with a stable purpose key, such as `dev-preview`.
- `pins_remove({ key })` removes a pin; an absent key is already removed.

Agents cannot choose another workspace through these tools. Repeated identical updates are no-ops, and updates preserve creation order. Concurrent changes to different pins are serialized; the last committed update wins for the same key.

Prefer `pins_apply` when changing multiple pins:

```json
{
  "upsert": [
    {
      "key": "dev-preview",
      "title": "Development preview",
      "url": "https://preview.example.com",
      "type": "app"
    }
  ],
  "remove": ["old-preview"]
}
```

Provide at least one operation, with at most 100 upserts and 100 removals. Duplicate keys within either list, keys appearing in both lists, and invalid pins reject the whole batch. Pins not mentioned are retained. Existing pins keep their order and creation time; new pins append in upsert order. All changes share the single-pin write queue and commit in one atomic write. A failed write leaves the previous list intact.

The response contains `upsert` results (`created`, `updated`, or `unchanged`, each with its pin and a `notified` boolean), `remove` results (`removed` with its pin or `absent` with its key), and `pins` plus `unreadCount`, the resulting snapshot at that commit. A follow-up `pins_list` is unnecessary. Repeating an identical batch is a no-op; omitted types preserve existing types. The single-pin tools use the same batch implementation internally.

Agents choose a resource type; the plugin chooses its icon:

| Type | Resource | Icon |
| --- | --- | --- |
| `app` | Development, staging, or deployed app | Globe |
| `review` | Pull request or changes to review | GitPullRequest |
| `docs` | Guides and reference | BookOpen |
| `example` | Demos and code examples | Code |
| `artifact` | Reports and deliverables | FileText |
| `link` | Other links | Link |

Omitting `type` preserves an existing pin's type; new pins and older saved pins default to `link`. The list shows a resource icon, title, and destination host (including the port). The resource link opens the original full URL; a separate checkmark acknowledges unread entries. There is no list heading, total pin count, or trailing external-link indicator.

New agents receive additional maintenance instructions, preserving their existing system prompt. Existing agents receive guidance in tool descriptions after Paseo reopens their session, normally before their next idle prompt following plugin installation. Attached tools remain subject to the provider's Paseo-tool settings. The creation-time instructions remain saved if the plugin is later disabled, and apply only when the pins tools are available.

## Notifications and acknowledgment

New pins start unread. Existing pins from before this feature start read. Unread pins show a **7px dot over the icon** and a semibold title; the workspace control shows **Pins (N)**, returning to **Pins** at zero. Opening the menu does not mark anything read.

For a meaningful update to an existing pin, add `notify` to an upsert or batch entry:

```json
{
  "key": "dev-preview",
  "title": "Development preview",
  "url": "https://preview.example.com",
  "notify": { "id": "build-8d31a2", "reason": "Updated onboarding is ready to review." }
}
```

Reuse an event ID for retries; choose a fresh ID for a different meaningful update. IDs are trimmed and limited to 128 characters; optional reasons to 240. A new event can notify without a URL change. Routine edits without `notify` preserve read state. Retrying any consumed event ID does not notify again, even after a newer event or acknowledgment. Each unread pin counts once.

Users can open a link, use its **Mark as read** checkmark (always visible on unread pins), or the top-right **ListChecks** action (tooltip: “Mark as read”) to mark all displayed updates read. The action stays visible but disabled when everything is read. Read state is shared across clients connected to this workspace on the same daemon. Acknowledgment captures the displayed notification token, so it cannot clear a newer update or a removed-and-recreated pin. Agents cannot acknowledge through maintenance tools.

The `pins.acknowledge` client RPC accepts `{ workspaceId, entries: [{ key, attentionToken }] }` and returns per-entry outcomes plus `pins` and `unreadCount`. Link opening acknowledges only after the opener succeeds. If acknowledgment fails after opening, **Retry** retries persistence without opening another tab. Chat links do not yet acknowledge pins.

## Data

Pins live on the daemon machine under `~/.local/share/paseo-pins/workspaces/`, in one JSON file per workspace ID. Set the daemon's `PASEO_PINS_DATA_DIR` environment variable to an absolute path to change the root. Restarting the plugin picks up its inherited environment; changing the daemon environment itself may require a later daemon restart.

Writes are serialized per workspace and committed with an atomic rename. Corrupt or newer-version data is preserved and reported as an error. Files remain after archive, disablement, or uninstall. A new workspace ID starts a new list, even for the same directory. Version 1 documents are read without rewriting and migrate to version 2 on the next successful mutation. Version 2 persists attention tokens, shared read state, and consumed notification IDs. An older plugin cannot read version 2; back up the data directory before an upgrade if you need a downgrade path.

Pins are links, not a secret store. The plugin rejects non-HTTP(S) schemes and embedded URL credentials, but agents must also avoid putting secrets in queries. It does not fetch links, start servers, or create tunnels. A remote preview address must be reachable from the user's device.

Mounted workspace controls and the popover share a query cache and refresh every two seconds. Other connected clients converge through this polling; failures retain the previous count/list and the menu exposes an error with Retry. Browser popup blocking cannot always be detected by the host opener.

See [PLAN.md](PLAN.md) for the agreed scope and product-review checkpoint. Sidebar access, chat summaries, file pins, and explicit Paseo-browser opening are deferred.

See [FUTURE_PROJECTS.md](FUTURE_PROJECTS.md) for the ten future project briefs and the product decisions behind them. Project 1 is implemented and awaiting working-feature review; the remaining briefs are planning notes.
