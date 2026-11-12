# Implementation checkpoint

Pins is installed from this directory as `paseo-pins` on the local `lal` daemon, running Paseo 0.15.2. The plugin reports `running`, and its load log reports ready without errors.

## Completed focused checks

- `npm run typecheck` passes against the 0.15.2 plugin SDK.
- `npm test` passes sixteen tests covering ordering and idempotency, workspace isolation, durable reads from a fresh store, concurrent writes, shutdown, URL validation, invalid stored data, write failures, cancellation, tool scoping, instruction preservation, resource-type updates, and legacy pin compatibility.
- The tool lifecycle test invokes the actual tool definitions directly with calling-agent contexts. It does not launch a model session or exercise the provider transport.
- Inspected the real popover through the daemon's web app in a temporary local Chromium profile: empty and populated states, light and dark themes, and a 390px compact viewport. Compact access works through **Workspace actions → Pins**.
- Clicking the reference pin opens a browser tab at the exact destination and closes the popover. No page errors were recorded.
- Client source uses React Native primitives and theme colors. The DOM audit found only TypeScript generic syntax, not browser-only component code.

The live workspace currently contains four user-requested test pins (homepage, pull requests, plugin guide, and changelog). The previous reference pin was removed through the live tools. The automated browser profile and screenshots are in `/tmp/paseo-pins-qa/`; these are temporary verification artifacts, not plugin dependencies.

## Resource-icon design update

Implemented the selected resource-icon layout with destination hosts, no content heading or count, and no trailing external-link indicator. The workspace trigger and Paseo-owned compact sheet navigation retain their Pins labels. Agents can choose app, review, docs, example, artifact, or link; the plugin maps types to icons. Existing pins without a type remain readable as link, and updates that omit type preserve it.

Focused checks pass: typecheck and twelve tests, including a type-only update, preservation when type is omitted, invalid type rejection, and reading legacy data without rewriting it. The running UI was checked in light/dark and at 390px; the existing untyped reference pin renders its fallback icon. Clicking opens the exact full URL and closes the popover. The visual-check selector was scoped to the workspace menu after the Design tab introduced a second Pins label.

## Batch-tool update

Added `pins_apply` with whole-batch validation, duplicate/conflicting-key rejection, per-operation results, and the resulting list. Single-pin writes now delegate to the same queued atomic implementation. All deterministic checks and sixteen tests pass, including mixed operations, no-op retries, invalid batches with no partial writes, failed writes, cancellation, concurrent single/batch changes, workspace scoping, and shutdown. A live `pins_apply` call subsequently renamed two test pins, added the changelog pin, and removed the examples pin. The response confirmed all changes, preserved the unmentioned pull-requests pin, and returned the resulting four-pin list without a follow-up list call.

## Pending product review

The repository now has a deterministic local gate, `npm run check`, combining Biome lint/import organization and formatting checks, TypeScript, Knip, jscpd, and the sixteen focused tests. All pass. Temporary fixtures confirmed that lint, formatting, unused-file, and duplication violations each return a failing exit code; the fixtures were removed. Biome formatted the source, two internal-only schema exports were made private, and a test's non-null assertion was replaced with an explicit assertion. The intentional URL control-character rejection has one documented, line-specific lint suppression. No canvas files were reformatted.

Review **Pins** in the workspace header, or **Workspace actions → Pins** on a narrow layout. Check the list presentation and external-link behavior. The plugin tools become available to existing agents when Paseo next reopens their session, normally before the next idle prompt after installation. New agents also receive the creation-time maintenance instructions.

Per the supplied AGENTS.md workflow, comprehensive validation follows approval of the working feature. Still pending: restart and reconnect checks in an isolated daemon, broader client/provider coverage, and native mobile inspection. No merge or publication has been performed.

## Notifications and icon badge checkpoint

Implemented project 1 from [the notification plan](plans/01-notifications.md). The selected canvas reference is **Pins · Notifications → Selected**, with a 7px dot over the icon in both themes. The other placements remain as earlier alternatives. Read and touch reference states now use the selected placement too.

The implementation adds version 2 persistence with lazy legacy migration, explicit idempotent `notify` events, token-matched acknowledgment, shared read state, a polling header count, and separate row/Mark all controls. Opening acknowledges only after a reported successful open; an acknowledgment-only retry never opens another tab. Original pins start read.

Focused validation:

- The deterministic local gate passes: Biome lint/format, TypeScript, Knip, jscpd, and 23 tests. New cases cover migration, same-URL notifications, older-event retries, durable read state, malformed metadata, stale/duplicate/absent acknowledgments, recreated keys, concurrent writes, failed writes/cancellation, tool notification inputs and scoping, and marking more than 100 displayed pins read.
- The plugin reloads from this repository and reports `running`. The live web menu initially showed all four existing pins as read, with no client errors.
- Temporary QA pins exercised the actual live list and acknowledgment RPC. Verified closed-menu counts, light/dark rendering, keyboard focus, no text shift after acknowledgment, menu staying open for checkmarks and Mark all, and convergence of two browser clients.
- Verified external opening uses the exact URL, marks the captured update read, and closes the menu. A simulated opener failure leaves the pin unread. Client-local RPC failure injection verified both acknowledgment Retry and the acknowledgment-only retry after opening; the latter opens no extra tab.
- Verified compact menu titles and content at 390px, plus a touch-enabled Chromium client with always-visible checkmarks and 44px acknowledgment targets. This is browser touch emulation, not a native-device check.
- Temporary QA pins were removed; the four original links remain. A pre-migration data backup is at `/tmp/paseo-pins-before-notifications`. Temporary scripts and screenshots are in `/tmp/paseo-pins-qa`.

Agent tool definitions were exercised directly in the focused tests. Reload invalidated this active agent's older tool bindings (`Tool pins_apply not found`); the live UI fixtures therefore used the store code directly, sequentially, and did not validate provider tool transport. Existing sessions receive the updated tool definitions when reopened.

**Pending:** user review of the working implementation, then comprehensive validation: isolated-daemon restart/reconnect and migration-failure checks, supported provider transports, and native desktop/mobile clients. No commit, merge, or publication was performed for this feature.

### Top-right list actions

Replaced the footer's Mark all text with a `ListChecks` icon in a right-aligned toolbar above the pins. Hover and keyboard focus show “Mark as read”; the accessible name remains “Mark all pins as read”. The action is disabled when everything is read, and an empty list omits the toolbar. Touch retains a 44px target. Selected canvas references and the notification plan match this change.

Focused checks: formatting/lint, TypeScript, Knip, and whitespace checks pass. Live Chromium inspection confirmed that Paseo renders the icon, the toolbar sits above the list, the old footer is absent, and the tooltip works on hover/focus in light/dark themes, with no page errors. These checks did not acknowledge the user's unread pins. Working-feature review and broader validation remain pending.

### Built-in menu styling

Matched active menu typography to Archive workspace (13px, 18px line height, medium weight, theme foreground). Unread titles use semibold. The menu now uses theme surface2, 4px desktop row insets, 16px resource icons, and rounded hover rows with a 12% theme-foreground overlay. Desktop width is approximately 276px including host padding instead of 344px. The compact layout still fills the available width. Paseo owns the outer popover chrome.

Lint/format, TypeScript, and Knip pass. Live browser inspection compared the title's computed color, size, weight, and line height directly against Archive workspace; verified 276px desktop width, 4px row insets, full-width compact divider, and light/dark rendering with no page errors. No pins were opened or acknowledged. Updated the selected canvas reference and plan; working-feature review remains pending.

### Hover and spacing correction

The reference Pull row applies 72% overall opacity to its 12% foreground hover. Pins now applies the equivalent 8.64% foreground overlay to the background only, preserving active foreground text. Reduced row corners to 8px and set the divider-to-first-row gap equal to the side inset (4px desktop, 12px compact). Updated the selected canvas styles and plan. Lint, format, TypeScript, and whitespace checks pass; live light/dark inspection confirmed the corrected desktop hover, corners, and spacing. No pin state was changed.

### Notification cutout

The 2px halo around the 7px notification dot now repaints the menu surface plus the same theme-foreground overlay as the row during hover, focus, and press. This masks the resource icon without a contrasting ring. Lint/format and TypeScript pass. Live light/dark checks confirmed matching row/halo colors and opacity on hover and keyboard focus; no pins were acknowledged.

### Per-pin acknowledgment hover

The checkmark action now has its own theme surface1 fill and border on hover/press, foreground icon color on hover/focus, and an accent border for keyboard focus. Hovering only the row leaves the button unfilled. Lint/format and TypeScript pass; live light/dark inspection confirmed separate button hover and keyboard focus without acknowledging any pins. The selected canvas reference includes the button treatment.

### Always-visible unread checkmarks

Unread pins now always show the checkmark, including desktop pointer layouts. Its independent background still appears only on hover, focus, or press. Updated the canvas reference and current behavior documentation. Lint/format and TypeScript pass; browser checks verified resting visibility plus hover/focus distinction in light and dark without acknowledging pins.

## Styling review and commit checkpoint

Reviewed the uncommitted styling/design/documentation changes against `83928c4` with two independent read-only reviewers (UI/design-system/accessibility and correctness/regression/architecture). Both final reviews report no actionable findings after these fixes:

| Finding | Resolution | Verification |
| --- | --- | --- |
| P2: acknowledgment hover/focus could keep a read row highlighted after its checkmark unmounted | Ignore acknowledgment-only interaction state immediately when read, then clear it while preserving link hover/focus | Reproduced before the fix in the real composed route; pointer exit, keyboard acknowledgment, and a subsequent notification now all clear the obsolete highlight |
| P3: selected canvas layout overrode its Row padding control | Restore `var(--row-padding)` in the selected link rule | Both 2px and 8px values verified on all six selected/read/touch artboards |

Final scoped validation passed: the complete `npm run check` gate (lint, formatting, TypeScript, Knip, duplicate detection, and all 23 tests), plus whitespace checks. Browser review covered light/dark desktop and 390px touch-emulated layouts, long-title wrapping, 44px touch actions, always-visible unread checkmarks, independent button feedback, stable text alignment, full-width divider, equal top/side list insets, Mark all behavior, and the selected canvas preview. Paseo reports the reloaded plugin running.

Browser-local RPC fixtures exercised acknowledgment transitions without changing live pins. Temporary validation scripts and screenshots are under `/tmp/paseo-pins-qa/review-*`. Native-device, broader provider, and isolated-daemon restart coverage was not run for this styling-only commit; those earlier feature-validation limitations remain. No merge or publication is authorized by this checkpoint.

### Empty-state width correction

The empty message is now just “No pins yet”, centered. An attempted 140px content width exposed an important host constraint: Paseo's outer popover enforces `min-width: 280px`, independently of plugin content. Earlier 276px measurements described the content/divider bounds, not the full host shell. The installed button API exposes no popover-width override.

Removed the content-only shrink and set desktop content to 254px (280px minus the host's 2px border and 24px padding). This centers the message across the actual menu and paints its whole interior consistently. Corrected the plan and selected canvas width to 280px. Lint/format and TypeScript pass. A browser-local empty fixture verified the full outer width, text center, and edge-to-edge background without touching live pins. A narrower outer popover remains unsupported by the current plugin API; no Paseo internals were changed.

### Selected icon-button colors and toolbar spacing

The per-pin acknowledgment button uses the darker canvas option on hover, focus, and press: 18% theme foreground mixed into surface2 in light themes, and surface0 in dark themes. The toolbar action retains its existing border-token hover fill. Added 4px below the toolbar button before the divider, and updated the selected canvas reference.

TypeScript and scoped Biome checks pass. Browser-local fixtures verified valid light/dark button colors, unchanged toolbar fill, the 4px gap, pointer/keyboard acknowledgment, subsequent notifications, and 44px touch targets. The touch sheet inset check uses a half-pixel tolerance for animated positioning after an exact comparison differed by 0.049px. The plugin was reloaded and reports running. Comprehensive validation remains pending product review; live pins were not changed.

### Empty-state and icon-button commit review

Two independent reviewers checked all changes against `17fa5bb`, including the untracked theme helper and canvas variants. Correctness/regression/architecture and UI/theme/accessibility reviews both found no actionable issues. The public plugin contract specifies hex theme colors, which the helper uses without relying on host internals.

The complete `npm run check` gate passed: lint, formatting, TypeScript, Knip, duplicate detection, and all 23 tests. This completes the comprehensive validation deferred above. The existing composed-route light/dark desktop and touch-emulation checks cover the final implementation; native-device inspection was not performed. No live pin data was changed during validation.

### Mobile menu styling correction

Compact content now inherits the host sheet background instead of painting a desktop surface over it. Native compact notification halos use surface0; browser halos keep surface2 to match that host's menu. Native titles use 14px regular text (semibold when unread), secondary hosts use 12px, and the 16px resource icons align with the built-in menu's label rail. Compact rows use the same 4px outer inset as the reference, and the redundant 12px content padding above the toolbar is removed. The mark-read background calculation uses the actual surrounding surface. Desktop geometry and colors are preserved.

The native styling reference was read from Paseo's public v0.15.2 `components/ui/menu/menu-item.tsx`, `components/adaptive-modal-sheet.tsx`, and plugin content wrapper; no Paseo files were modified. A phone-sized browser alone does **not** reproduce native styles: the native sheet uses surface0, while the browser uses surface2. The initial typography comparison also sampled the browser's default 14px before its saved 13px preference loaded; repeating after settings settled established the stable reference.

Scoped Biome and TypeScript checks passed. Browser-local fixture checks compare both actual menus at 390px in light/dark: label x=37px, matching browser text size, matching sheet/notification-halo color, full-width divider, 4px list insets, 44px actions, wrapped titles, and per-pin/mark-all acknowledgment. Desktop light/dark acknowledgment and subsequent-notification checks also passed. Actual plugin components were additionally rendered with Android layout props in an isolated React Native Web harness: 14px regular titles, surface0 halos, 44px targets, and acknowledgment passed in both themes. Screenshots and scripts are in `/tmp/paseo-pins-qa/mobile-*` and `native-*`; the touch canvas reference is updated. These previews use a browser renderer and mock pin data, not an Android/iOS device. Native-device verification and comprehensive checks remain pending product review.

### Mobile styling commit review

Two independent reviewers inspected the complete five-file diff against `e5d3c96`; correctness/regression/architecture and UI/theme/accessibility reviews reported no actionable findings. The final native touch canvas was also rendered and visually inspected in light/dark, confirming matching surfaces, 14px titles, and no horizontal overflow.

The complete `npm run check` gate passed: lint, formatting, TypeScript, Knip, duplicate detection, and all 23 tests. Comprehensive validation deferred above is complete. Actual Android/iOS device verification remains outstanding; browser and Android-layout previews do not substitute for that coverage.

## After-turn chat summaries — working-feature review

Implemented against SDK/manifest minimum **0.15.4**. The normal development daemon remains on **0.15.2**, using its previously loaded plugin; it was not restarted or upgraded. No live workspace pins were changed. Activation on that daemon requires a compatible Paseo version and a plugin reload.

Focused implementation checks:

- TypeScript and Biome checks pass for the changed code. Knip passes; jscpd found no duplicate blocks. `git diff --check` is clean.
- 34 focused tests pass: the existing 23 plus 11 summary tests covering consolidation, routine updates, notification retries, per-agent snapshots, pin lifetimes, create/remove, historical links, hidden-entry acknowledgment, stale tokens, atomic write failure/cancellation, turn-end/write ordering, failed append recovery, active-turn recovery, and late/nullable end events.
- A separate released Paseo **0.15.4** daemon runs on `127.0.0.1:6779`, with daemon home `/tmp/paseo-pins-integration-home` and pin data `/tmp/paseo-pins-integration-data`. It loads a copy of this plugin with test-only hooks/RPCs and a deterministic provider. These fixtures exercise real host lifecycle hooks, SDK timeline append/history, client registration, and plugin RPCs without invoking a model or changing Paseo code. Real-provider transport coverage remains pending.
- Actual composed chat previews inspected in light/dark desktop and 390px touch layouts. Three initial entries, expansion/collapse, shared read state, full-summary acknowledgment, 44px touch controls, interrupted-turn label, and browser reload all passed. No page errors. Native iOS/Android rendering remains pending; touch emulation is not a native-device test.
- A real link open used the captured build-42 URL. Injected acknowledgment failure preserved state; Retry acknowledged without opening a second tab. After changing the current pin to build-43, the old chat entry still opened build-42; both per-link and summary acknowledgment preserved the newer unread update.
- The released host replaces repeated same-ID appends without duplicating the visible row. Its append sequence advances, so the plugin still checks history before retrying rather than re-appending existing rows to update read state.

**Restart finding:** although 0.15.4 includes durable timeline implementation code, its shipped bootstrap does not supply that store to the agent manager. A real isolated daemon restart therefore lost the host timeline rows. The plugin journal restored the missing summary exactly once with the same identity and captured entries, labeled **Recovered pin updates** with the original turn time. Normal reload preserves the row; daemon restart may change its placement. The earlier plan's assumption that upgrading alone supplied durable host rows has been corrected. This limitation needs product review; no host patch is proposed.

The app also rejects dotted timeline renderer kinds that the append API accepts. Implementation uses the supported `turn-summary` identifier. The isolated browser caught this before activation.

Working screenshots and test harnesses are under `/tmp/paseo-pins-qa/`: `chat-desktop-light.png`, `chat-desktop-dark.png`, `chat-mobile-light.png`, `chat-mobile-dark.png`, `chat-expanded.png`, and `chat-interrupted.png`. The real client is rendered inside Paseo in these images; they are not canvas mockups.

**Pending:** product review (including the restart limitation), native-device and real-provider coverage, broader recovery/pagination/failure validation, and the comprehensive repository gate after that review. No commit, merge, or publication has been performed for this feature. Existing pre-commit hooks remain enabled.

### Read-by-default additions and command-group presentation

New pins now start read, even if creation supplies `notify`; a supplied event ID is consumed so retrying creation does not notify. Explicit new events on existing pins still notify. Added summary entries can carry a null attention token and never acknowledge a later update. Existing stored unread states are preserved. Tool guidance and current behavior documentation reflect this policy.

The full-width summary now has a plain heading, right-side acknowledgment/collapse controls, and indented entries beside a vertical rule. There is no enclosing border, fill, or rounded card. Collapsing hides the entire body and preserves the Show all state.

TypeScript, scoped Biome, and both focused test suites (36 tests) pass. Two new regressions cover read creation/retries and historical read additions versus later notifications. Actual Paseo 0.15.4 fixture previews passed light/dark desktop and 390px touch layouts, three/four-entry expansion, disabled acknowledgment for read additions, header-only collapse, Enter-key expansion, preserved expansion/read state, 44px touch controls, and no page errors. Width matches the available host content area; the host's display-contents wrapper must be skipped when measuring it. Screenshots inspected: `/tmp/paseo-pins-qa/group-{desktop,mobile}-{light,dark}.png`. Native-device inspection and comprehensive checks remain pending product review.

The user has upgraded the live daemon to 0.15.4. The plugin was reloaded from this repository. All four former live test pins were removed and four new pins created, each with `notified: false`, null attention, and total unread count zero. Reloading during this active session removed the session's tools, and the public SDK fallback reported a turn identity already finalized in the plugin journal. Both normal mutation attempts refused before writing. The requested reset was therefore completed through a temporary, workspace-specific plugin RPC using the normal atomic store operation without turn attribution. The RPC was removed immediately afterward and the normal plugin reloaded; this reset does not generate a new chat summary. Real-provider turn identity/reload behavior requires follow-up before considering after-turn integration fully validated. No Paseo files or internals were changed, and the isolated test daemon was stopped.

### Required update messages and selected accent-line design

Selected the thin accent line from `design/pin-update-messages`. The menu and chat share a message component with a 2px line taken directly from `theme.colors.accent`, muted theme text, and full wrapping up to the 240-character input limit. Menu messages appear only while unread; historical chat messages remain after acknowledgment. Accessible link labels include the update message. The resource icon and acknowledgment control stay aligned near the top of rows with messages.

New `notify` input requires a trimmed, nonempty `reason`; single and batch tools share that schema. Persisted attention and historical summary schemas continue accepting legacy entries without reasons. Updated agent guidance and documentation describe the required message. A regression verifies missing, blank, null, and non-string messages reject the entire batch before writes, trimming works, and saved legacy attention remains readable.

TypeScript, scoped Biome, whitespace checks, and the two focused test suites (37 tests) pass. An isolated React Native Web harness rendered the actual PinRow, SummaryRow, and shared PinMessage components in desktop and compact/native-layout props. Light, dark, and custom purple accents passed; computed line color exactly matched each accent, line width was 2px, long messages wrapped without horizontal overflow, touch acknowledgment targets were at least 44px, and acknowledgment removed only the menu message. Legacy message-less attention remained usable. Screenshots under `/tmp/paseo-pins-qa/accent-*` were visually inspected. These are component previews with fixture data, not a native-device or live-host integration test.

The repository plugin was reloaded and reports running. Live pins were not changed. Working-feature review, native-device coverage, and comprehensive validation remain pending. The previously recorded real-provider turn attribution/reload limitation is unchanged.


### After-turn summaries and notification messages: commit review

Two independent reviewers covered the full pending change against `bf53bbf`: server correctness/regressions/storage/concurrency and UI/theme/accessibility/history/reuse. One P2 was confirmed and fixed: recovery awaiting a host snapshot could finalize a completed turn as interrupted before its queued completion handler. Pending-end reservations and a local-active guard now give lifecycle evidence priority over a stale snapshot. Added regressions cover an end arriving during recovery and a temporarily inactive snapshot during a locally active turn. Both final reviews report no actionable findings.

The complete `npm run check` gate passed: lint, formatting, TypeScript, Knip, duplicate detection, and both test suites (39 test cases). The normal pre-commit hook remains enabled. Final composed previews in isolated released Paseo 0.15.4 passed desktop/mobile light/dark notification messages, three/all-entry expansion, full collapse, menu acknowledgment with retained chat messages, interrupted-turn labeling, injected acknowledgment failure/retry without reopening, and historical destinations preserving a newer unread update. Screenshots inspected include `/tmp/paseo-pins-qa/review-chat-desktop-light.png` and `review-menu-mobile-dark.png`. No live pins were changed by this review.

The user subsequently exercised two successful normal bulk notification calls in the real agent session. That verifies ordinary live mutations; the earlier reload-during-turn fallback issue is not claimed fixed by those calls. The recovery race fix addresses the reproduced ordering failure, while the broader reload/provider behavior and actual iOS/Android-device rendering remain limitations. The shipped host's restart placement limitation remains documented in README. Comprehensive repository validation deferred in earlier entries is now complete.


## Sections working-feature checkpoint — 2026-11-12

Implemented flat sections through `pins_apply`, nullable pin assignments, atomic removal/ungrouping, lazy v4 migration, grouped menu headings, snapshot/cache retention, and agent guidance. No Paseo changes.

- Typecheck passed. Focused pin, section, and summary tests passed; sections coverage exercises ordering, empty groups, schema rejection, atomic failure/cancellation, concurrent operations, silent maintenance, acknowledgment, v1–v3 migration, and corrupt-data preservation.
- Actual menu components and `usePins` rendered with mocked host RPCs in Chromium/React Native Web. Desktop/mobile-sized light/dark, wrapped headings, unsectioned-only/named-only/empty states, loading/retry, and acknowledgment cache retention passed. Inspected composed desktop/mobile and long-heading screenshots under `/tmp/paseo-pins-qa/sections-working-*.png`.
- Reloaded `paseo-pins` successfully from this repository; status `running`. Current-turn tool bindings were invalidated by the host reload. Live section assignment is pending the next agent session open; existing live pins were not edited directly.
- Working-feature review, native-device review, and comprehensive validation remain pending. No commit made.


### Sections and menu themes: commit review

Review scope is all pending changes against `c3716d3`: sections, refreshed design canvas, planning/docs, and the requested menu theme correction. Static checks found an unused `pinSectionSchema` export; it is now module-private. Independent UI review found obsolete migration wording in OVERVIEW; the overview now describes automatic migration without version details.

Live composed Paseo inspection confirmed five pins under Guides and Code and review, with an unsectioned pin first, on desktop and compact web in light/dark themes. The host supplies the menu surface; rows use `surface2` directly. Desktop uses `surface1`, compact web uses `surface2`, and native compact sheets use `surface0`; the unread dot matches the respective surface and hover fill. Compact web’s distinct surface was found during live review and the cutout selection was corrected. No live pin state was changed during review. Native rendering remains covered by component emulation, not an actual iOS/Android device.

The earlier live-data tests exposed an existing turn-identity bug: the provider reused `codex-turn-0` with a new start time, but Pins treated it as an older finalized turn. Normal writes were rejected before changing data. The requested demo resets were completed through PinStore while the plugin was disabled, then it was re-enabled; those resets produced menu notifications but no chat summaries. This pre-existing turn-attribution issue is outside the sections/theme change and remains unresolved; the final commit does not claim normal live tool integration is fully validated.

Both final independent reviews report no actionable findings after the fixes. The complete `npm run check` gate passed (lint, formatting, TypeScript, Knip, duplicate detection, and all three test files containing 44 cases). Final component checks cover desktop, compact web, and native-layout light/dark cutouts, transparent plugin content, exact hover tokens, and distinct acknowledgment-button hover. The corrected directory plugin was reloaded and reports running. Screenshots under `/tmp/paseo-pins-qa/review-sections-live-*` and `menu-theme-*` were inspected. The normal pre-commit gate remains enabled; actual native-device inspection and the existing turn-ID bug remain limitations.
