# Listing capture

Render the current plugin components with sample data to regenerate the images in `assets/`. This is isolated development tooling and is excluded from the plugin package. It does not connect to Paseo or change live workspace data.

From the repository root, install the main development dependencies first (`npm ci`). Then:

```sh
cd tools/listing
npm ci --ignore-scripts
npx playwright install chromium
npm run capture
```

The browser installation downloads Playwright's Chromium. To reuse a compatible existing browser, skip that download and set `PINS_CHROMIUM_PATH` to its executable when running capture. `PINS_CAPTURE_NO_SANDBOX=1` is available only for restricted development containers that cannot launch Chromium's sandbox normally.

The script starts a temporary loopback server, bundles the actual menu and chat components, and writes four 2× PNG captures, a side-by-side menu gallery, and the icon. The preview substitutes SDK RPCs and icons with local fixtures; it does not exercise the daemon or native renderer. Playwright checks that the expected content has loaded and that the page reports no JavaScript errors. Inspect the output in both themes before accepting it.

Update `fixture.jsx` for sample content and `preview.jsx` for the surrounding frame. UI behavior and styling belong in the runtime components, not copies of them in this tool. Named icons use Lucide; custom plugin icons use their original SVG. The icon mark lives in `assets/icon.svg`.

## Images and provenance

The images render the current `PinsPopover`, `PinsButtonIcon`, and `TurnSummary` components in React Native Web. Host RPCs, composer, pill frame, and surrounding conversation are fixtures. The desktop menu opens above the Pins pill beside Subagents; compact layouts show a bottom sheet. All names, links, and update messages are sample data; no live pins, conversations, or host settings are accessed. These are component previews, not captures of a live workspace or native iOS/Android app.

- `menu-light.png`: grouped resources and unread messages, with the Pins pill above the composer.
- `menu-dark.png`: the same resources in a dark palette.
- `menu-gallery.png`: light and dark captures arranged side by side with captions, avoiding GitHub's table borders in the README.
- `menu-compact.png`: compact web bottom sheet with touch controls.
- `chat-summary.png`: additions and updates captured after a turn, above the composer and Pins pill.
- `icon.png`: a 512px PNG rendered from the original `assets/icon.svg` mark.

Only the PNG assets ship in the plugin package. Regenerate them after changing the pictured components and inspect every result before publishing.
