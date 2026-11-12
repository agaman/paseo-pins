# Paseo pins

A Paseo plugin that lets agents maintain useful HTTP(S) links per workspace. Users open **Pins** in the workspace header (the workspace menu on narrow layouts) and click a link to open it externally.

## Development and installation

Requires Node.js 22 or newer for development and Paseo 0.15.4 or newer on both daemon and app.

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
- `pins_apply({ upsert?, remove?, sections? })` atomically applies multiple changes and returns their results plus the resulting pin list.
- `pins_upsert({ key, title, url, type?, section?, notify? })` creates or replaces a pin with a stable purpose key, such as `dev-preview`.
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

The response contains `upsert` results (`created`, `updated`, or `unchanged`, each with its pin and a `notified` boolean), `remove` results (`removed` with its pin or `absent` with its key), and `pins`, `sections`, and `unreadCount`, the resulting snapshot at that commit. A follow-up `pins_list` is unnecessary. Repeating an identical batch is a no-op; omitted types preserve existing types. The single-pin tools use the same batch implementation internally.

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

## Sections

Agents can group related pins beneath optional flat headings. Unsectioned pins appear first without a heading; populated sections follow creation order. Empty sections are retained for agents but hidden from the menu. Pin order within each group follows the original pin creation order. Chat summaries stay flat, and organization alone does not create notifications or summary entries.

Create sections and assign pins in one atomic batch:

```json
{
  "sections": {
    "upsert": [{ "key": "preview", "title": "Preview" }]
  },
  "upsert": [{
    "key": "dev-preview", "title": "Development preview",
    "url": "https://preview.example.com", "type": "app", "section": "preview"
  }]
}
```

Omit `section` to preserve an existing assignment (new pins default to unsectioned); use `null` to ungroup. Unknown section keys reject the entire batch. Section titles are trimmed, nonempty, and limited to 80 characters; keys use the same format as pin keys. Renaming a section preserves its position. `sections.remove: ["preview"]` removes that heading and ungroups its surviving members without deleting pins. Explicitly assigning to a section removed in the same batch is invalid; moving to another section is allowed.

Section-only batches are valid. At most 100 section upserts and 100 removals are accepted per batch. Duplicate/conflicting section keys are rejected; pin and section keys use separate namespaces. `sectionResults.upsert` reports `created`, `updated`, or `unchanged` with a section; `sectionResults.remove` reports `removed` with a section or `absent` with a key. All full snapshots include `sections: [{ key, title }]`, and every pin has `section: string | null`. Single-pin tools also return the full snapshot alongside their operation result. Global acknowledgment covers all groups and preserves organization.

## Notifications and acknowledgment

New pins start read, including when a creation request supplies `notify`. Creation-time notification IDs are consumed without notifying so retries stay silent. Existing pins from before this feature start read. Unread pins show a **7px dot over the icon** and a semibold title; the workspace control shows **Pins (N)**, returning to **Pins** at zero. Opening the menu does not mark anything read.

For a meaningful update to an existing pin, add `notify` to an upsert or batch entry:

```json
{
  "key": "dev-preview",
  "title": "Development preview",
  "url": "https://preview.example.com",
  "notify": { "id": "build-8d31a2", "reason": "Updated onboarding is ready to review." }
}
```

Reuse an event ID for retries; choose a fresh ID for a different meaningful update. IDs are trimmed and limited to 128 characters; required reasons to 240. A new event can notify without a URL change. Routine edits without `notify` preserve read state. Retrying any consumed event ID does not notify again, even after a newer event or acknowledgment. Each unread pin counts once. Every `notify` must include a nonempty `reason` explaining what changed and why it matters. The message wraps beside a 2px theme-accent line below the domain while unread in the menu; acknowledgment hides it there, while chat retains the captured message as history. Legacy saved updates without a reason still load without inventing a message.

Users can open a link, use its **Mark as read** checkmark (always visible on unread pins), or the top-right **ListChecks** action (tooltip: “Mark as read”) to mark all displayed updates read. The action stays visible but disabled when everything is read. Read state is shared across clients connected to this workspace on the same daemon. Acknowledgment captures the displayed notification token, so it cannot clear a newer update or a removed-and-recreated pin. Agents cannot acknowledge through maintenance tools.

The `pins.acknowledge` client RPC accepts `{ workspaceId, entries: [{ key, attentionToken }] }` and returns per-entry outcomes plus `pins`, `sections`, and `unreadCount`. Link opening acknowledges only after the opener succeeds. If acknowledgment fails after opening, **Retry** retries persistence without opening another tab. Chat links acknowledge only their captured update, even when its destination has since changed.

## Data

Pins live on the daemon machine under `~/.local/share/paseo-pins/workspaces/`, in one JSON file per workspace ID. Set the daemon's `PASEO_PINS_DATA_DIR` environment variable to an absolute path to change the root. Restarting the plugin picks up its inherited environment; changing the daemon environment itself may require a later daemon restart.

Writes are serialized per workspace and committed with an atomic rename. Corrupt or newer-version data is preserved and reported as an error. Files remain after archive, disablement, or uninstall. A new workspace ID starts a new list, even for the same directory. Version 1–4 documents are read without rewriting and migrate to version 5 on the next successful mutation. Version 5 adds the current/latest refresh run beside ordered section definitions and nullable pin assignments, preserving pin lifetime IDs, the turn-summary journal, attention tokens, shared read state, and consumed notification IDs. Pin mutations and summary candidates commit together. Earlier plugin versions cannot read version 5; retain a data backup if you need to downgrade.

Pins are links, not a secret store. The plugin rejects non-HTTP(S) schemes and embedded URL credentials, but agents must also avoid putting secrets in queries. It does not fetch links, start servers, or create tunnels. A remote preview address must be reachable from the user's device.

Mounted workspace controls and the popover share a query cache and refresh every two seconds. Other connected clients converge through this polling; failures retain the previous count/list and the menu exposes an error with Retry. Browser popup blocking cannot always be detected by the host opener.

See [PLAN.md](PLAN.md) for the agreed scope and product-review checkpoint. Sidebar access, file pins, and explicit Paseo-browser opening are deferred. After-turn summaries are implemented; see [their plan](plans/02-after-turn-summaries.md) and [validation checkpoint](VALIDATION.md).

See [FUTURE_PROJECTS.md](FUTURE_PROJECTS.md) for the ten future project briefs and the product decisions behind them. Project 1 is committed; project 2 is implemented for working-feature review. The remaining briefs are planning notes.

## After-turn summaries

New pins and explicit notifications appear in one block per originating agent turn. The full-width block follows Paseo’s command-group styling: a plain collapsible heading and indented rows beside a vertical rule, without an enclosing card. Collapse hides all rows; expansion does not change read state. The block shows three historical entries initially, with **Show all** for the remainder. Its **Mark as read** action acknowledges every eligible captured update, including hidden entries. Failed or canceled turns still show committed changes with **Turn interrupted**. Routine edits/removals alone do not produce a block, and old changes are not backfilled.

Historical entries keep their original title, URL, type, reason, and attention token (null for additions without a later flagged update). Removing a pin does not erase its chat links. Summary RPCs validate workspace, conversation, and summary identity; paginated reads are limited to 25 entries per page. Tool mutations reject a missing turn identity before writing so changes cannot silently be attributed to another turn.

Turn identity includes the provider's ID and the host's turn start time, so a provider restarting its counter does not collide with an older completed summary. That identity survives plugin reloads; existing historical summary IDs and links remain intact. If the host cannot supply a valid start time, mutations fail before writing and can be retried when the snapshot is available. Recovery waits when a matching active turn has an incomplete timestamp.

An end event supplies only the provider ID. If no tool call captured the turn instance in this plugin session, Pins cannot safely assign that event's outcome to a saved summary. Once the host confirms that the saved turn is no longer active, recovery publishes it as interrupted instead of guessing that it completed.

**Restart limitation:** the shipped 0.15.4 daemon does not retain plugin timeline rows across daemon restarts in the tested configuration. The plugin restores missing rows from its journal, labeling them **Recovered pin updates** with the original turn time. Restored rows are appended and may appear later in chat. Reconciliation begins on the first plugin hook/RPC connection, also runs when opening a conversation, and retries pending work every 30 seconds. No Paseo source changes are required or made.


## Agent-powered refresh

Use the Refresh icon in the Pins toolbar to discover links from ongoing work and maintain existing pins, including when the list is empty. No saved profile is required: **Automatic** uses the provider and current model of the most recently active non-archived, non-refresh agent in this workspace whose provider is available. Other settings retain provider defaults. With no suitable workspace agent, it selects an available provider (ordered by provider ID) and its advertised default model, or first selectable model if none is marked default. All discovery and creation use Paseo’s public APIs; no provider is hard-coded. You can optionally select a saved profile in **Pins settings → Agent refresh** to override this across workspaces on the host. A missing explicitly selected profile requires choosing Automatic or another profile; it is never silently replaced.

Refresh chooses its strategy once, from the pin count at the start. An empty list uses **discovery** to establish a curated initial set; a populated list uses **maintenance**, focusing on recent work, addressed/superseded items, and useful new resources. Empty does not override explicit removal instructions, and unavailability alone does not justify deletion.

The worker identifies important work before looking for destinations. It reviews up to ten recent workspace conversations: discovery initially scans up to four 50-entry pages per conversation, while maintenance starts with one. Narrative excerpts include non-URL work; a separate bounded URL index groups repeat mentions and provides source references for surrounding context. Long messages and omitted page entries can be retrieved in chunks. The worker uses older history or read-only repository evidence for specific gaps. At least half of the 80,000-character delivery budget is reserved for follow-up retrieval. The index is a retrieval aid, not a popularity ranking or complete workspace inventory.

The final report internally accounts for active priorities as a selected destination, coverage by an existing pin, no useful destination after investigation, or an unresolved gap. Reports validate source and pin references; semantic relevance still depends on the agent. Legacy runs retain their prior report contract. The selected provider receives the context; Pins persists source references and concise assessments, not another copy of the conversations. The URL index is reconstructed after reload.

Refresh may discover a small curated set of HTTP(S) links, update/remove existing pins, and reorganize sections. New discoveries start read. The worker is instructed to change only pins and sections, never repair resources, edit files, or restart services. This task instruction is not a provider-wide sandbox; the plugin enforces scope and revision checks in its own mutation tools and preserves the profile’s permission behavior.

Progress and pin-change totals appear beneath the toolbar. Only failed, timed-out, or permission-limited runs offer expandable troubleshooting details. Routine uncertainty and unverified counts stay out of the menu; a refresh with no changes says “No pins changed.” Cancel, permission requests, errors, and the five-minute deadline retain committed changes and explain unfinished work. The seven scoped refresh tools are automatically approved per request through Paseo’s permission API for the active worker only, including workspace file listing, literal text search, and line-based reading. File inspection derives its root from the worker’s workspace, rejects traversal and symlinks, excludes dependency/build/metadata directories, and bounds file sizes and output. It is used only to fill specific conversation-context gaps; skipped or truncated results remain incomplete evidence. Other permission requests are denied and the worker is archived rather than waiting for approval. Unverified pins are retained. Only one run may be active per workspace; unsuccessful worker cleanup blocks another run until archival is confirmed. Dismissal hides the result only for the current client session.

Version 5 stores pin mutations and run-result entries atomically. Scoped worker tools are `pins_refresh_list`, `pins_refresh_context`, `pins_refresh_apply`, and `pins_refresh_report`. Apply batches require operation IDs, inspected resource revisions, explanations, and source references for new pins. Section removal also requires revisions for every affected member. Normal agents retain their existing tools. User acknowledgment does not create revision conflicts; newer resource edits and notification events do.

Recovery starts when a plugin hook or RPC next supplies a Paseo connection, then observes active workers every two seconds. Deadlines remain fixed across reloads and are checked in every worker write. An uncertain launch is reconciled by its persisted worker ID rather than launching a replacement. Workers are ordinary workspace conversations and are archived after completion; their own normal pin summaries never appear in the main conversation.
