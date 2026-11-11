# Notice new and meaningfully updated pins

Help the user identify workspace resources that need attention without making routine pin maintenance noisy. Add shared read/unread state, explicit agent update signals, and acknowledgment controls to the existing compact menu. Show the unread count as **Pins (2)** in the workspace control, returning to **Pins** when nothing is unread.

**Status:** implemented and reloaded locally; awaiting working-feature review. Selected design: the 7px icon badge in `design/pin-notifications`, in light and dark. Working-feature review and comprehensive validation remain pending. This expands [future project 1](../FUTURE_PROJECTS.md#1-notifications-and-updates).

## In this plan

- [Experience and boundaries](#experience-and-boundaries): the agreed appearance and what makes a pin unread.
- [Agent interface](#agent-interface): signal meaningful changes using the existing single and batch tools.
- [Persistence and acknowledgment](#persistence-and-acknowledgment): retain shared state and protect newer updates from stale acknowledgments.
- [Client integration](#client-integration): update the closed-menu count and keep devices consistent.
- [Implementation and validation](#implementation-and-validation): a concrete sequence and acceptance checks for handoff.

## Experience and boundaries

New pins and explicitly flagged updates get a 7px unread dot over the top-right of the resource icon and a slightly stronger title. No leading status column or extra left indent is added. Everything else keeps the current compact presentation, ordering, resource icons, destination text, and hover treatment.

Agreed behavior:

- Existing pins start **read** when this feature is introduced. Newly created pins always start **unread**.
- Agents decide whether an existing pin has a meaningful update. Changing its URL, title, or type alone does not notify; an update at an unchanged URL can notify.
- Count distinct unread pins, not update events. Updating the same unread pin repeatedly still counts as one. Removing an unread pin removes its contribution to the count.
- Opening a pin acknowledges the update the user opened. Merely opening the menu does not acknowledge anything.
- Offer per-pin **Mark as read** and **Mark all as read**. The per-pin checkmark appears on hover or keyboard focus, and remains visible on touch devices.
- Read state is shared across all clients connected to the same workspace on the same daemon. Separate identities and read histories for different people are outside this first version.

```text
Workspace controls                         [ Pins (2) ▾ ]
                                           ┌──────────────────────────────┐
                                           │                  [ListChecks]│
                                           │ [icon●] Development preview ✓│
                                           │          preview.example.com │
                                           │ [icon●] Review changes      │
                                           │          github.com          │
                                           │   [icon] Plugin guide        │
                                           │          paseo.sh            │
                                           └──────────────────────────────┘
```

The checkmark is shown on the hovered/focused first row in this illustration. Reserve its space to prevent layout shifts. Use the existing 13px title size, changing weight from regular to medium for unread pins; do not increase row height or reintroduce a list title, total count, icon background, or external-link indicator. The 7px dot uses the theme accent with a 2px surface-colored halo; its overlay leaves text aligned with read pins. The unread dot and accessible label must make state understandable without relying on font weight or color alone.

Place the mark-all action in a compact toolbar above the list, aligned right. Use a `ListChecks` icon with the tooltip “Mark as read” and accessible name “Mark all pins as read”. Keep it visible but disabled when there are no unread pins, and hide the toolbar for an empty list. This row can accommodate future crosscutting actions. Its action applies to the unread updates in the displayed list, protecting updates that arrive concurrently. Clicking a checkmark must not open the link or close the menu. After marking all displayed updates read, leave the menu open.

This project adds no OS notifications, sounds, sidebar surfaces, previews, agent refresh, or chat blocks/chips. The acknowledgment contract will support historical references when the separate chat projects ship. Ordinary Markdown links in today's chat cannot yet acknowledge pins automatically.

## Agent interface

Extend the existing `pins_upsert` input and each `pins_apply.upsert` entry with an optional `notify` object. No new maintenance tool or extra call is needed.

```json
{
  "key": "dev-preview",
  "title": "Development preview",
  "url": "https://preview.example.com",
  "type": "app",
  "notify": {
    "id": "preview-build-8d31a2",
    "reason": "Updated onboarding flow is ready to review."
  }
}
```

`notify.id` is a nonempty, trimmed string of at most 128 characters identifying one meaningful event for that pin. Agents reuse it when retrying the same event and choose a fresh ID for a new event. A build/revision identifier or another stable event token is suitable. Optional `reason` is nonempty when supplied, trimmed, and limited to 240 characters. Store and return it for future summaries; this project does not add another text line to the menu.

| Operation | Attention behavior |
| --- | --- |
| Create, with or without `notify` | Create one unread update. If supplied, consume the notification ID as part of that same update. |
| Edit existing pin without `notify` | Preserve its current attention and read state. |
| Existing pin, previously unseen notification ID | Create a new unread update, even if all resource fields are unchanged. |
| Previously consumed notification ID | Do not generate another unread update or replace the original update reason. Apply any ordinary resource edits using existing semantics. |
| Remove | Remove the pin and its attention state. |

Retain the existing `created`, `updated`, and `unchanged` operation statuses. An attention-only change is `updated`; an identical retry with no resource or attention changes is `unchanged`. Return `notified: boolean` on upsert results so future summary renderers can distinguish attention events from maintenance. Return attention information and derived `unread` in pin tool responses; the agents do not get an acknowledgment tool.

Validate notification input alongside all other batch input before any mutation. Notification changes commit atomically with resource edits/removals. A failed write must not consume an event ID or report a notification. Keep the existing optional-type behavior and all single/batch guarantees.

Update the tool descriptions and new-agent guidance: new pins notify automatically; use `notify` only for meaningful changes; reuse its ID on retries; prefer batches for multiple changes. Distinguish the agent's event ID from the server-issued acknowledgment token below.

## Persistence and acknowledgment

Store attention state in the existing daemon-owned workspace document. Reuse its serialized mutation queue and atomic rename for both agent changes and user acknowledgments.

### Versioned record

Introduce a version 2 document. Separate the persisted pin schema from tool-command inputs so `notify` is not accidentally stored as an unapplied command. Alongside the existing pin fields, persist:

| Field | Meaning |
| --- | --- |
| `attention` | `null` for a migrated pin with no notifications; otherwise `{ token, notifiedAt, reason? }`. |
| `readAttentionToken` | The last acknowledged attention token, or `null`. |
| `consumedNotificationIds` | Unique agent event IDs already consumed during this pin's lifetime. |

Generate a fresh opaque token, such as a UUID, for every newly created attention event. The server owns tokens and times. A pin is unread exactly when it has attention whose token differs from `readAttentionToken`; derive the count from the list rather than persisting an independent counter.

Keep consumed IDs for the lifetime of the pin, including older IDs, so retrying event A after event B cannot make A notify again. This is a deduplication ledger, not a resource snapshot/history store. Deleting a pin deletes its ledger. Recreating the same purpose key starts a new lifetime and receives a fresh server token, preventing an old acknowledgment from clearing the recreated pin.

Do not change resource `createdAt` or `updatedAt` when acknowledging a pin. A resource edit or new attention event updates `updatedAt`; a no-op notification retry does not. Preserve pin ordering throughout.

### Migration

Accept valid version 1 documents and normalize their pins to `attention: null`, `readAttentionToken: null`, and an empty consumed-ID ledger. This makes all existing pins read without manufacturing new notifications.

Reads may return this normalized view without rewriting the file. The next successful resource or acknowledgment mutation persists version 2 under the same queue and atomic save path. A true no-op need not rewrite version 1. Preserve title, destination, type, timestamps, and ordering. Continue rejecting malformed or unknown-version documents without replacing them.

Keep version 2 validation strict for attention metadata rather than silently defaulting malformed fields. Document that the older plugin will reject version 2 files; back up workspace pin data before an upgrade that needs a downgrade path. This project does not change the storage directory or adopt a new Paseo storage API.

### Acknowledgment RPC

Add a client RPC, provisionally `pins.acknowledge`, accepting the workspace ID and a nonempty array of `{ key, attentionToken }` entries. Return per-entry outcomes (`acknowledged`, `already-read`, `stale`, or `absent`) plus the resulting pin list and unread count. The client can batch the entire displayed unread list in one request; do not impose the agent tool's 100-operation limit on **Mark all as read**.

Inside the workspace mutation queue, reread the latest state and acknowledge only entries whose current attention token equals the supplied token. Already-read, missing, and stale entries are successful no-ops. Write once if any acknowledgment changed state. Malformed requests fail before writing; write failures preserve all previous state. Duplicate keys in a request are invalid.

```text
User sees token A → agent creates token B → user acknowledges A
                                          result: B stays unread
```

Every client sends the tokens it actually displayed. Do not implement an unqualified server-side “mark everything currently unread” command. The same RPC will later acknowledge captured chat references without clearing newer attention.

After a link-opening request succeeds, acknowledge the captured token and close the popover after successful persistence. If opening rejects, leave it unread and show the existing opening error. If opening succeeds but acknowledgment fails, keep the menu available with “Link opened, but couldn't mark it as read” and an acknowledgment-only retry; do not reopen the URL on retry. Browser popup blocking is not always detectable by Paseo's opener, so acknowledgment follows the opener's reported outcome, not proof of a completed page visit.

## Client integration

Observe pin state while the workspace control is mounted so the unread count updates even when the popover is closed. Share the list/query state with the popover and refresh other devices from the daemon.

### Header and compact menu

The installed SDK supports `PluginButtonRegistration.update({ label, title })`, custom icon components that can use plugin hooks, and `useRpc`. Use a stable custom Pin icon component as the mounted query observer; pass its count result to the owning registration through an effect. Update only presentation fields when the count changes. Replacing the behavior would close the popover and is unnecessary.

Keep the ordinary Pin icon. Set both `label` and `title` to `Pins (N)` for positive counts and `Pins` at zero: the same title also supplies the compact workspace-menu entry, so it must remain concise. Announce unread state explicitly on individual row accessibility labels. Do not squeeze a numeric badge into the fixed-size icon slot or require a Paseo API change.

Create one shared query hook keyed by host and workspace identity. Header and popover observers use it with the existing two-second refresh interval, fetching immediately on mount/reconnect. Reuse the installation's TanStack Query cache and coalesce in-flight requests; avoid a separate per-workspace scheduler that polls every workspace in the sidebar. Stop observers on unmount/archive/plugin cleanup and avoid background polling for suspended clients.

Cross-device synchronization is eventual: while the relevant UI is mounted and connected, an update or acknowledgment should appear within the polling interval plus request latency. A returning client fetches current state. Before the first successful fetch, show plain `Pins`; on later fetch errors retain the last known count/list rather than presenting a false zero. Opening the menu exposes the read/refresh error and retry action.

### Row controls

Refactor each row into a layout containing sibling press targets: the resource link and the acknowledgment checkmark. Do not nest an acknowledgment button inside the existing link press target.

- Overlay the dot within the existing 24px icon box; keep the action slot stable so text does not jump as focus/hover or read state changes.
- Use theme tokens for the dot, text, and focus/hover feedback; keep the existing icon background absent.
- On pointer interfaces reveal the checkmark while the row is hovered or either action has keyboard focus. The action remains keyboard reachable even while visually concealed. On touch, show it for unread pins without requiring hover; hybrid devices must still be operable.
- Label the action “Mark {title} as read” and expose unread state in the link's accessibility label. Preserve a usable touch target and visible keyboard focus.
- Disable an in-flight acknowledgment action to avoid accidental repeat requests. Treat stale-token results as benign and render the returned newer state.

Use pessimistic acknowledgment: keep the unread indicator until the server confirms persistence. On success, cancel/ignore older in-flight cache results, update the shared query with the returned list, and invalidate/refetch to capture any subsequent concurrent changes. On failure, retain unread state and show a retryable error. The same path serves row checkmarks, Mark all, and successful link opening.

### Verified API basis

This plan targets the existing 0.15.2 SDK. Its local button declarations expose mutable labels/titles and component icons; its RPC and server-handler declarations support the required request/response calls. Public docs also describe hook-enabled custom icons, presentation updates, and host-managed compact menus. [Paseo button contracts](https://paseo.sh/docs/plugins/reference#custom-icons-and-popover-content)

The first UI checkpoint must confirm that the mounted observer updates both the desktop label and compact menu title without remounting or closing content. If host rendering prevents this, investigate the supported component lifecycle before proposing a different UX; do not silently substitute a native badge or hidden all-workspace polling.

## Implementation and validation

Implement the state rules before the presentation, then review the working feature with the user before broader validation.

1. **Shared contracts and store:** separate resource/tool schemas, add version 2 attention metadata and version 1 normalization, implement event deduplication and token-matched acknowledgment through the existing queue.
2. **Agent/server integration:** add `notify` to single/batch inputs, return attention results, register the acknowledgment RPC, and update guidance. Keep workspace isolation and failed-write behavior intact.
3. **Client integration:** add the shared query hook and header observer, then unread styling and separate acknowledgment controls. Integrate successful opening with acknowledgment-only retry behavior.
4. **Product checkpoint:** present the actual compact menu, hover/focus/touch controls, closed-menu count changes, and two-client synchronization. Update the canvas as a design reference if useful. Do not restart the daemon hosting the development conversation.
5. **Completion:** after product approval, finish comprehensive validation and update README, overview, and validation notes. Commit, merge, and publication follow their separate authorizations; retain the pre-commit gate.

### Focused deterministic checks

Extend the existing store/tool tests with these acceptance cases:

- Version 1 pins begin read; migration preserves resource data and timestamps, and corrupt/unknown documents remain intact.
- A new pin contributes one unread count; routine edits preserve state; an unseen event ID notifies at an unchanged URL; duplicate event IDs do not notify again, including after acknowledgment or a newer event.
- A single batch creates/updates/removes pins and their attention atomically. Failed validation, failed writes, and cancellation consume no event IDs and preserve the previous list.
- Single and bulk acknowledgments only clear matching tokens. Include a newer update racing with Mark all, a removed/recreated key, duplicate acknowledgment, and missing pins.
- Acknowledgment does not change resource timestamps/order. Concurrent agent writes and user acknowledgments share the queue and retain unrelated changes. Reloaded stores retain read state and deduplication IDs.
- Agent tools remain scoped to the caller's workspace. Notifications cannot be acknowledged through agent tool inputs. Operation statuses and `notified` accurately distinguish resource edits, attention events, and no-ops.

Run `npm run check` for lint/import order, formatting, TypeScript, Knip, duplication detection, and the focused suite. Use browser inspection for genuine UI behavior: count updates with the menu closed, no acknowledgment on menu opening, independent link/checkmark actions, hover/keyboard/touch access, opening and acknowledgment failures, dark/light themes, and a narrow layout. Verify two clients converge on the same state and that stale responses do not permanently restore cleared indicators.

After the working-feature review, exercise restart/reconnect and migration failures in an isolated daemon, then supported desktop/web/native clients and agent providers. Keep these broader checks separate from the fast implementation feedback loop.
