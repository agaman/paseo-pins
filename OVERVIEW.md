Pins keeps useful links for each Paseo workspace, such as development previews, pull requests, documentation, and deliverables. Open **Pins** above the chat composer on desktop or mobile to browse resources and open them in your device's browser.

Agents can add, organize, and maintain pins as they work. The plugin adds tools and guidance to agents to help keep the list current. Meaningful updates can carry a short message and an unread dot, and new pins and updates appear in chat summaries after agent turns.

- **Find pins** and **Refresh pins** ask a temporary agent to discover and maintain resources from recent workspace conversations. Changes apply automatically. Runs stop after five minutes; canceling retains changes already saved.
- **Keep** protects individual pins from agent removal. You can still remove them yourself and undo the latest removal while the menu stays open.
- Projects can supply shared links through `.paseo/pins.json`. These pins are managed through that file rather than the pin tools.
- Workspace lists and read state are shared across connected devices. Read state belongs to the workspace, not to each person separately.

## Setup

Requires Paseo **0.15.4 or later** on both the daemon and app. Enable **Paseo tools** under **Settings → your host → Agents** so agents can manage pins. New or reopened agent sessions receive the tools and guidance.

Find and Refresh need an available, authenticated agent provider. In Pins settings, **Automatic** uses the workspace agent's provider and model, falling back to an available provider when needed. Choose a saved agent profile to use it across the host's workspaces.

## Data access and limits

Find and Refresh send recent workspace conversation context and requested repository excerpts to the selected provider, using its normal allowance or billing. The plugin's file-inspection tools stay within the workspace and refuse symlinks. The worker is instructed to maintain pins, not edit project files or repair services; those instructions do not sandbox the provider. Discovery may find no useful changes, and uncertain resources are retained.

Pins, notification history, and refresh state are stored on the daemon machine under `~/.local/share/paseo-pins/`, or an absolute directory configured with `PASEO_PINS_DATA_DIR`. Disabling or uninstalling leaves this data intact.

Links must use HTTP or HTTPS. A localhost address points to the viewing device, not a remote daemon; Pins does not create tunnels. On Paseo 0.15.4, historical plugin chat summaries do not survive a daemon restart.
