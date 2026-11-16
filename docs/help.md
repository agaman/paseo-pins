# Using Pins

Open **Pins** above the chat composer, beside Tasks and Subagents. It opens a popover on desktop and a sheet on mobile. Each workspace has its own list, shared across its agents and your connected devices.

## Find and refresh

An empty list offers **Find pins**. It asks a temporary agent to identify useful resources from recent workspace conversations. When pins exist, the toolbar offers **Refresh pins** to maintain them and find useful additions.

Changes apply automatically. Refresh may update destinations, regroup sections, or remove obsolete agent-managed pins. Kept and repository-configured pins are protected from removal. The worker is instructed to change only pins and sections, not repair servers or edit project files; that instruction is not a sandbox for the provider.

You can cancel from the status row. Runs stop after five minutes; changes already saved remain. Successful results dismiss automatically after viewing. Expand an error for details. Refresh may find no useful changes, and uncertain links are retained.

Refresh uses the selected provider's normal allowance or billing. It sends recent workspace conversation context and any repository excerpts requested for investigation to that provider.

## Updates and Keep

New pins start read. An agent can flag a meaningful change to an existing pin with a message. The dot and **Pins (N)** count indicate unread updates; opening the menu alone does not clear them.

Open a link, press the checkmark beside its message, or use the toolbar's **Mark as read** action. Acknowledgment is shared across devices. Chat summaries retain their captured destinations and messages; acknowledging an older summary does not clear a newer update.

The outline pin beside an item enables **Keep**; a filled pin means protected from agent removal. Keeping does not prevent changes to the title or destination. Items labeled **Repo** are owned by [repository configuration](configuration.md) instead.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Pins is missing | Check the intended host under Settings → Plugins. The plugin must be enabled and running; daemon and app need Paseo 0.15.4 or later. |
| An agent cannot add pins | Enable Paseo tools in Settings → your host → Agents. Start a new conversation or let the existing session reopen. A turn already running during plugin reload may still have old tool bindings. |
| Refresh fails | Expand its error. Check that a provider is available and authenticated. In Pins settings, choose Automatic or an available saved profile. Manage profiles under Settings → your host → Agents. |
| Refresh misses a resource | Ask the workspace agent to pin it directly. Discovery is selective and may lack enough conversation context. |
| A link opens on desktop but not mobile | Links open on the viewing device. A localhost URL points to that device, not the remote daemon. Ask your agent for an address you can reach. Pins does not create tunnels. |
| Repo configuration is invalid | Fix the error in `.paseo/pins.json`. The last valid list is preserved; resource mutations and new refresh runs pause until the file is valid. |
| Old summaries disappear after restarting Paseo | The tested 0.15.4 host does not preserve plugin timeline rows across daemon restarts. Pins keeps its journal but does not replay old summaries into chat. |

For loading errors, inspect **Settings → Plugins → Pins → Logs**, or run `paseo plugin logs paseo-pins`. [Report persistent problems](https://github.com/agaman/paseo-pins/issues) with Paseo versions, client/platform, and steps to reproduce. Remove private URLs and conversation text from logs or screenshots first.

## Storage and removal

Pins data lives under `~/.local/share/paseo-pins/` on the daemon machine. Workspace lists, notification history, and refresh state are saved together. Read state is shared per workspace, not per person. A new workspace ID gets a new list, even for the same directory.

Disabling or uninstalling leaves data intact. Back up this directory before removing data or downgrading the plugin. An absolute `PASEO_PINS_DATA_DIR` in the daemon environment overrides its location. Profile selection is stored separately in Paseo's host settings.
