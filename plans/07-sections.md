# Group related pins without complicating the menu

Help users scan a growing pin list by letting agents organize related resources under optional, flat section headings. Keep unsectioned links first, preserve the existing compact rows and notification controls, and leave chat summaries flat. Sections organize resources; they do not create attention events.

**Status:** implemented and reloaded for working-feature review (2026-11-12); comprehensive validation is pending product approval. The agreed product choices are simple non-collapsible headings, unsectioned pins at the top without a heading, and flat after-turn summaries. The tool and ordering details below are implemented. Design: **Pins · Sections** (`design/pin-sections`). Earlier designs were cleared at the user’s request and remain available in Git at `c3716d3`.

## In this plan

- [Menu experience](#menu-experience): add quiet headings while preserving the current link and acknowledgment behavior.
- [Agent tools and ordering](#agent-tools-and-ordering): extend the existing batch tool with section management and explicit pin assignment.
- [Storage and implementation](#storage-and-implementation): migrate existing pins safely and keep section changes atomic with pin changes.
- [Validation and delivery](#validation-and-delivery): verify organization, notification safety, migration, and the working UI before comprehensive checks.

## Menu experience

Sections add a label and a little separation, not a second navigation system. Agents own organization; users continue to open links and acknowledge updates.

```text
                               Pins (2) ▾
┌──────────────────────────────────────┐
│                                 [✓≡] │
├──────────────────────────────────────┤
│ [icon] Project home                  │  Unsectioned: no heading
│        example.test                  │
├──────────────────────────────────────┤
│ Preview                              │  Muted section heading
│ [icon●] Development preview      [✓] │
│         preview.example.test         │
│         │ Mobile navigation is ready.│
│ [icon] Staging                       │
│        staging.example.test          │
├──────────────────────────────────────┤
│ Review                               │
│ [icon●] Review changes           [✓] │
│         github.com                   │
│         │ Spacing feedback addressed.│
│ [icon] Layout notes                  │
│        docs.example.test             │
└──────────────────────────────────────┘
```

- Render unsectioned pins first, with no “Other” heading. If none exist, start directly with the first populated section.
- Use small, sentence-case headings in `theme.colors.foregroundMuted`, with no icon, count, chevron, or heading action. Expose headings to assistive technology; headings are not focusable controls.
- Use the existing theme border for separators between visible groups. Keep a modest gap around headings and the existing 4px row inset, compact width, hover treatment, notification dot, and accent-line message. Do not place each section inside a separate card.
- Long headings wrap rather than hiding their identity. Native/compact layout uses the same group structure within Paseo’s sheet, existing touch targets, and appropriate host surface colors.
- Hide sections with no pins. They remain in storage and tool results so an agent can populate or remove them. If the workspace has no pins, show the existing centered “No pins yet” empty state, even if empty section definitions exist.
- No sections means the current flat menu. A single populated section still shows its name if an agent explicitly created it.
- The global acknowledgment action includes all unread pins across groups. Section headers have no acknowledgment control. Merely creating, renaming, removing, or moving between sections does not mark anything read or unread.

After-turn chat stays flat and retains its existing order, historical links, and captured update messages. Organization alone produces no chat block. If the same batch also creates a pin or explicitly notifies an existing pin, those qualifying changes produce normal entries without section labels.

## Agent tools and ordering

Reuse the current tools rather than adding a parallel set of section tools. `pins_list` and mutation results expose the complete section definitions and pin assignments; `pins_apply` can manage sections and pins in one atomic request.

Proposed shape:

```json
{
  "sections": {
    "upsert": [
      { "key": "preview", "title": "Preview" },
      { "key": "review", "title": "Review" }
    ],
    "remove": []
  },
  "upsert": [
    {
      "key": "dev-preview",
      "title": "Development preview",
      "url": "https://preview.example.test",
      "type": "app",
      "section": "preview"
    }
  ]
}
```

Section keys use the existing stable purpose-key format: lowercase letter followed by lowercase letters, digits, or hyphens, up to 64 characters. Titles are trimmed, nonempty plain text, at most 80 characters. Keys identify sections; renaming preserves the key. Duplicate titles are allowed, but guidance should discourage confusing duplicates and unnecessary one-pin sections.

| Input / operation | Result |
| --- | --- |
| Pin `section` omitted | Preserve its assignment on an existing pin; default a new pin to unsectioned. |
| Pin `section: null` | Explicitly move the pin to the unsectioned group. |
| Pin `section: "review"` | Assign to that existing or same-batch-created section. Reject unknown section keys. |
| `sections.upsert` with an existing key | Rename in place; preserve its position. Identical input is unchanged. |
| `sections.upsert` with a new key | Append the section in request order. |
| `sections.remove` | Delete the definition and move surviving members to unsectioned; never delete those pins. Removing an absent section is a no-op. |

Keep section order by creation order for v1; no reorder operation or user drag-and-drop. Preserve the canonical pin array’s existing order and creation times. Display each group by filtering that array, so moving a pin does not rewrite everyone’s positions. Example: canonical order A, B, C with A/C in Review renders A then C within Review; moving B into Review renders A, B, C. This gives deterministic, stable ordering without another ordering field.

`pins_apply` accepts up to 100 section upserts and 100 section removals, alongside its existing pin limits. A section-only batch is valid; an entirely empty request is not. Duplicate keys within or across section upsert/removal lists reject the request. Pin and section keys use independent namespaces, so the same string may identify one of each.

Evaluate the final result before saving: apply section upserts/removals and explicit pin changes to a candidate document; clear assignments for surviving pins whose section was removed. An explicit assignment to a removed or unknown section rejects the entire batch. Moving members elsewhere while deleting their old section is valid. Pin removal remains explicit through the existing `remove` list. Invalid input, cancellation, or failed persistence leaves all pins, sections, read state, and summary records unchanged.

Return existing per-pin statuses and notification results, plus `sections: [{key,title}]` in the snapshot and a `sectionResults` object containing upsert/removal statuses. Each returned pin includes `section: string | null`. Single-pin upsert gains the same optional assignment field; existing callers omitting it keep their assignments. Single-pin removal leaves any now-empty section definition intact. All responses returning a full workspace snapshot include sections so client cache replacement cannot accidentally discard grouping; count-only summary acknowledgment responses stay unchanged.

Guidance should tell agents to reuse section keys, group by a useful purpose such as Preview or Review, leave a small list ungrouped when appropriate, remove obsolete empty definitions, and prefer one batch for related changes. Section names and movements are maintenance, not reasons to send a notification; `notify` still requires a meaningful resource update and its message.

## Storage and implementation

Keep using the daemon-owned workspace JSON and serialized atomic mutation queue. All capabilities fit existing plugin APIs; no Paseo changes or new release are required beyond the current 0.15.4 baseline.

Introduce document version 4 with an ordered `sections` array and nullable `section` on current pins. Read versions 1–3 without rewriting, supplying `sections: []` and `section: null`; migrate on the next successful mutation. Preserve every pin lifetime ID, URL, canonical position, timestamp, attention token, consumed notification ID, and historical summary. Older plugin versions cannot read v4; document that downgrade limitation.

Validate stored section-key uniqueness and pin references as well as mutation inputs. Missing section references in a v4 document are corrupt data and should use the existing preservation/error path, not silently erase the assignment. Removal explicitly clears assignments before saving. Recreating a deleted section key does not reclaim formerly assigned pins.

Implementation work:

1. Extend shared input, snapshot, and document schemas. Keep historical `SummaryEntry` unchanged, since chat grouping is outside v1.
2. Make `PinStore.list`/snapshot access read pins and sections from the same document. Extend `apply`, single-pin operations, and acknowledgment responses consistently. Keep summary acknowledgment’s small count-only response as-is; it invalidates the full workspace snapshot.
3. Add section mutations to the existing queue and tool execution path. A section-only call uses the existing active-turn validation but creates no summary candidate. Assignment updates may advance affected pins’ `updatedAt`, like other routine edits; preserve attention and `createdAt`. Renaming a section leaves pin timestamps alone.
4. Extract a pure grouping helper: unsectioned first, then populated sections in stored order, each with stable pin order. Reuse existing `PinRow`, message, icon, and menu actions. Global unread count stays pin-based.
5. Update guidance and plugin documentation. Keep the historic chat renderer unchanged. Update `usePins` cache writes and all full-snapshot consumers to retain sections.

Repo configuration, section collapse, per-section actions, sorting/reordering, nested sections, custom section icons, and chat grouping are deferred. A future repo-config feature can use these stable section keys but does not introduce ownership rules in this project.

## Validation and delivery

The feature is ready for product review when an agent can atomically create sections and assign pins, the menu displays them clearly, and read/history behavior remains intact.

Focused deterministic coverage:

- v1/v2/v3 migration preserves existing pins and summary history; reading alone does not rewrite files; corrupt v4 references remain preserved and reported.
- Section creation/rename/delete, omitted and null assignments, same-batch creation and assignment, and explicit reassignment during deletion behave as specified.
- Duplicate/conflicting operations, unknown references, invalid titles, write failures, and cancellation reject the entire batch. Concurrent agents share the existing queue and preserve unmentioned state.
- Grouping yields unsectioned first and stable section/pin order; empty definitions do not create headings; removing/recreating a key does not reassociate pins.
- Organization-only changes neither create attention nor generate summaries; mixed batches retain normal Added/Updated history. Global acknowledgment spans every section and cannot clear a newer notification.
- All snapshot-returning operations retain sections in the cache. Legacy callers omitting `section` do not ungroup pins.

Inspect real composed menus on desktop and mobile-sized layouts in light and dark themes, including no groups, only named groups, mixed groups, empty list, long labels, wrapped notification messages, and loading/error/retry. Check keyboard order and heading semantics; keep native-device coverage distinct from browser/native-layout emulation.

Present the implementation for user review with comprehensive validation pending. After approval, run the repository’s required lint, format, type, unused-code, duplication, and test gate. Commit only when requested, with normal hooks. The design remains available for comparison; the runtime feature is ready for review.

**Design verification:** all eight local artboards rendered without script errors or horizontal overflow. Desktop/light, mobile/dark, long-heading, and flat-chat screenshots were inspected. Prototype checks covered stable grouping, removing a section without losing pins, hiding empty groups, acknowledgment across sections, compact empty-state width, and chat collapse with retained historical messages. These are design checks, not runtime feature validation or native-device verification.

**Implementation checkpoint (2026-11-12):** typecheck and focused storage/tool/summary tests passed, including five sections-specific tests. Browser previews use the actual `PinsPopover`, `PinRow`, and `usePins` with mocked host RPCs and React Native Web. Desktop and mobile-sized light/dark layouts, long labels, flat/named/empty lists, loading/retry, and acknowledgment retaining section cache data passed. Screenshots were inspected. The directory plugin was reloaded successfully. Native-device verification and the full repository gate remain pending. Reload invalidated this active conversation’s old tool bindings, so live pin grouping must be exercised after the next session open; no direct storage editing was used.

**Review follow-up:** live grouped-menu inspection is complete on desktop and compact web in light/dark themes. The sample pins were populated through controlled plugin-owned storage resets after normal tools exposed the pre-existing reused-turn-ID bug. See [validation notes](../VALIDATION.md) for the distinction between verified menu behavior and the unresolved turn-attribution issue.
