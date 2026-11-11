# Future projects for Paseo Pins

Make workspace resources easier to notice, revisit, and maintain. These ten project briefs extend the existing agent-managed Pins menu with attention indicators, chat integration, richer destinations, and durable organization. They record the product decisions from our discussion for later implementation.

**Status:** project 1 has been separately approved and implemented, awaiting working-feature review. Projects 2–10 remain planned work only; this document does not authorize their implementation. Each brief needs technical shaping and a working-feature review when picked up; this is not an implementation sequence or a commitment to ship every item.

## Project index

| Brief | Intended outcome |
| --- | --- |
| [1. Notifications and updates](#1-notifications-and-updates) | Notice new resources and meaningful changes without counting repeated updates twice. |
| [2. After-turn chat summaries](#2-after-turn-chat-summaries) | See the resources produced or updated by an agent turn. |
| [3. Inline pin references](#3-inline-pin-references) | Reference a pin naturally within a chat message. |
| [4. Thumbnail previews](#4-thumbnail-previews) | Recognize a web resource before opening it. |
| [5. Agent-powered refresh](#5-agent-powered-refresh) | Reevaluate the existing list without interrupting the main conversation. |
| [6. Additional destinations](#6-additional-destinations) | Open workspace files, Paseo browser pages, and diffs. |
| [7. Sections](#7-sections) | Group related resources while retaining a simple list. |
| [8. Repo configuration](#8-repo-configuration) | Define persistent resources and environment-based destinations in the repository. |
| [9. Link health and expiry](#9-link-health-and-expiry) | Identify unavailable resources without silently removing them. |
| [10. Keep this pin](#10-keep-this-pin) | Protect a useful resource from agent pruning. |

## Shared behavior

Pins remain workspace-scoped and shared by that workspace's agents. Keep the current compact, theme-aware list and atomic single/batch mutation behavior. Users gain acknowledgment, refresh, and protection controls; general user editing remains outside these briefs.

Three concepts stay separate: the pin's resource data, whether its latest meaningful update has been read, and whether its destination is currently available. A health check is not an agent refresh, and a title correction is not automatically a notification.

**Chat captures a historical reference.** Both summary entries and inline chips retain the title, icon/type, destination, and update identity captured when created. Later pin edits must not silently redirect old messages. Capturing a destination does not archive the web page or file contents behind it.

Existing pins beginning read when notifications are introduced is now agreed in the first project's detailed plan. The following remain proposed implementation defaults: opening a historical reference acknowledges only its captured update, leaving any newer update unread; section order stays stable and empty sections are hidden; background refresh reports progress and completion in the menu. Confirm these defaults when shaping the relevant project.

## 1. Notifications and updates

Detailed plan: [Notice new and meaningfully updated pins](plans/01-notifications.md). Agreed first-version refinements: existing pins begin read; unread rows use the selected 7px dot over the top-right of the resource icon and a slightly stronger title; the shared workspace count appears as `Pins (N)` because the installed API has no separate badge field. Per-pin acknowledgment stays visible on unread pins, with a distinct button background on hover/focus/press.

Show users which pins are new or have changes worth their attention, with an unread count on the Pins control and a distinct appearance for unread rows. The first version uses the label `Pins (N)`; a separate badge is deferred.

- New pins start unread. Agents explicitly flag meaningful updates, including changes to content at an unchanged URL. Editing a title, URL, or other field does not itself mark an existing pin unread.
- Count distinct unread pins in the menu badge. Repeated updates to one unread pin still contribute one; merely opening the menu does not clear the count.
- Opening a pin from either the menu or chat marks the corresponding update read. Provide per-pin **Mark as read** and **Mark all as read** controls. Read state follows the user across devices.
- Add an explicit attention signal to single and batch tools, with an optional short update reason. Acknowledgment must not erase a newer update arriving concurrently. A failed opening attempt should leave attention intact.

Illustrative behavior, not a final layout:

```text
[ Pins (2) ▾ ]
  [icon●] Development preview       [Mark as read]
  [icon●] Review changes            [Mark as read]
  [icon ] Project guide
  ──────────────────────────────────────────
  Mark all as read
```

## 2. After-turn chat summaries

Append one compact block showing the useful pins added or meaningfully updated during an agent turn.

- Include new pins and updates explicitly flagged for attention. Routine edits and removals do not produce entries in this block.
- Consolidate repeated changes to the same pin within a turn, using the final committed reference. Omit pins created and then removed before the turn ends; show no empty block.
- Render clickable entries with resource icons, titles, and optional update reasons. Preserve their historical destinations and acknowledge the corresponding updates when opened.
- Associate changes with the originating agent and turn, including batch calls. Ensure reconnecting or reloading chat neither duplicates the block nor loses it. Define behavior for interrupted turns that already committed changes during technical shaping.

**Dependency:** notification/update identities from brief 1 and supported Paseo timeline integration.

## 3. Inline pin references

Let an agent refer to a pin within ordinary prose using a compact clickable chip containing its icon and title.

- Provide an agent-facing reference mechanism through the pin tools and their instructions; agents should not invent opaque identifiers or manually reconstruct rendering syntax.
- Capture the same historical reference data used by after-turn summaries. Clicking an old chip opens its captured destination, not the pin's latest destination.
- Opening the chip acknowledges its corresponding update. Removing a pin from the current list does not rewrite old messages or retarget a reference to a newly created pin with the same key.
- Preserve a useful ordinary link/text fallback when rich rendering is unavailable, including copied/exported messages. Confirm keyboard, touch, and streaming-message behavior.

**Dependency:** shared reference/acknowledgment behavior and a supported way to extend inline chat rendering.

## 4. Thumbnail previews

Show a cached thumbnail when the user hovers over a web pin, helping them recognize the destination before opening it.

- Automatically capture the page when the pin is created or explicitly marked meaningfully updated. The initial scope is web destinations, with no agent-supplied image override.
- Capture asynchronously and cache by destination/revision so opening the menu or hovering does not wait on page loading. A changed URL must invalidate an image of the old destination, even when the change does not notify the user.
- A failed or unsupported capture leaves a usable ordinary pin. Previewing a pin does not mark it read.
- Define an equivalent keyboard interaction and a suitable touch behavior during design. Reuse the same preview mechanism for chat references only if it can preserve their historical reference semantics.

**Technical shaping:** choose the supported capture runtime, authentication context, cache lifetime, and handling of local/private resources. Do not assume the daemon and the user's browser can reach the same destinations.

## 5. Agent-powered refresh

Add **Refresh pins** to reevaluate the current list in a separate temporary agent, leaving the main conversation uninterrupted.

- Review existing pins, update destinations when necessary, and prune resources confirmed obsolete. Discovering new resources is outside this refresh action's scope.
- Respect config ownership and user protection: refresh must preserve config-defined and kept pins. Unreachability or expiry alone is not sufficient evidence for deletion.
- Show progress and a useful completion/error result; prevent duplicate refresh agents from repeated clicks. Give the agent workspace context and the pin-maintenance instructions, and retire it after completion.
- Apply related changes in batches. Mark only meaningful changes for attention; a refresh with no relevant changes must not create unread pins.

**Technical shaping:** select the temporary agent's provider/profile and permissions, define cancellation/time limits, and confirm its supported lifecycle. Lightweight health checks in brief 9 do not launch agents.

## 6. Additional destinations

Expand pins beyond external HTTP(S) links to workspace files, Paseo browser pages, and diffs.

- Represent destination kind separately from resource type: `docs` or `review` still describes the resource and selects its icon, while the destination determines how it opens.
- Resolve files against the pin's workspace and open them in Paseo's file viewer. Support Paseo browser destinations with external-browser fallback when that browser is unavailable, matching the previously stated opening preference.
- Support diffs as explicit targets with enough context to identify the file/change comparison. Decide the initial supported diff forms before implementation; distinguish a live working-tree diff from a fixed revision comparison.
- Use the same opener from the menu, summaries, and inline chips. Preserve existing HTTP(S) pins and report unavailable files, workspaces, or comparisons clearly.

**Technical shaping:** verify supported navigation from header popovers and chat surfaces; include a small Paseo API prerequisite if necessary. No private route construction or unsupported client imports.

## 7. Sections

Let agents group related resources into optional, flat sections without turning the menu into a nested navigation system.

- Pins may remain unsectioned. Sections have names and stable workspace-scoped identities; there are no nested subsections.
- Extend list and mutation tools so agents can create/manage sections and assign or move pins. Changing organization alone does not notify the user.
- Keep pin order stable within a section and preserve a predictable section order. Section deletion should move its remaining pins to the unsectioned group rather than delete them.
- Allow repo configuration to declare sections and assignments, subject to the same ownership rules as configured pins. Avoid repeated empty headings in the menu.

## 8. Repo configuration

Define persistent pins in a repository config file, with optional environment-variable substitution for workspace-specific destinations.

- The file owns configured pins. Changes and removals go through that file; agent pin tools and refresh/pruning cannot override or remove them. Show their origin and reject conflicting keys clearly.
- Resolve explicit variable references from the workspace's configured environment. Do not automatically read `.env` files or execute commands. Do not commit resolved workspace values back into the config.
- Validate the config and resolved destinations. Config errors must not destroy the last valid list or unrelated agent-managed pins; missing variables need a clear unresolved-state indication without exposing variable values in diagnostics.
- Define stable keys, optional resource types/sections, and an opening target. Reconcile file changes without duplicating pins or repeatedly marking identical entries unread.

**Technical shaping:** choose the file location/schema, environment-resolution API, and reconciliation triggers. Config authority governs resource definitions; read state, cached previews, and health results remain runtime state.

## 9. Link health and expiry

Help users identify unavailable or expired resources while retaining the pins for review.

- Run lightweight, cached health checks when the menu opens or the user explicitly requests a check. Do not poll continuously in the background or launch an agent for these checks.
- Mark unreachable destinations and pins whose declared expiry time has passed. Retain both kinds of pin; health checks never automatically delete them.
- Distinguish a definite failure from an unknown result, authentication requirement, or unsupported check. A failed probe does not necessarily mean the resource is obsolete.
- Keep health/expiry separate from unread state and user protection. An agent may use the evidence during a refresh, but removal requires confirmation that an unprotected, agent-managed resource is obsolete.

**Technical shaping:** choose timeouts/cache lifetime, expiry metadata, and where checks run. A daemon-only failure must not be represented as proof that a link is inaccessible from the user's device.

## 10. Keep this pin

Give users a **Keep** control that prevents agents from pruning a resource they still need.

- Store protection on the workspace pin and show it in tool results and the menu. Support an explicit user action to remove that protection.
- Enforce protection in the server for single and batch removal, including refresh-agent operations. A batch that tries to remove a protected pin must fail without partially applying other changes.
- Protection prevents removal; ordinary destination/title maintenance can continue under the existing update rules. Health and expiry indicators still apply.
- Config-defined pins are already protected by file ownership. Make that distinction clear rather than suggesting a user can unkeep a configured pin to let agents delete it.

## Dependencies and implementation boundaries

These are small project briefs, not detailed designs. Each can be shaped independently, but the following shared contracts should be settled before dependent work begins:

| Shared contract | Projects affected |
| --- | --- |
| Stable pin identity, meaningful-update identity, and acknowledgment | Notifications, both chat features, previews |
| Historical references and a common destination opener | Both chat features, additional destinations |
| Ownership and protection enforced by the mutation layer | Repo configuration, Keep, refresh, sections |
| Supported capture/check runtime and network context | Previews, link health |

The current plugin targets Paseo 0.15.2. Public documentation describes timeline transformers/renderers and appended plugin rows, plus browser navigation on supported surfaces. It does not by itself establish that every required operation is available from our installed header popover or inline chat renderer. Verify the chosen SDK and host release before implementation; newer Paseo releases are acceptable. [Paseo plugin reference](https://paseo.sh/docs/plugins/reference)

In particular, verify inline chip extensibility, durable chat history, file/diff navigation, capture APIs, workspace environment resolution, and temporary-agent lifecycle. Raise any resulting product tradeoff before implementing a workaround.

For each project, use focused deterministic checks and proportionate visual inspection, present the working behavior for user review, then complete comprehensive validation before merge. Keep feature approval, commit requests, merge authorization, and publication separate.
