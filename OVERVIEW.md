# Pins

Pins keeps useful links within reach in each workspace. Open **Pins** in the workspace header to see previews, review requests, staging environments, and other resources your agents have saved. On compact layouts, Pins appears in the workspace menu.

Agents can list, add, update, and remove links, including multiple changes in one atomic batch. The plugin teaches them to reuse entries and remove resources known to be obsolete. Users click links to open them in their external browser. New agents receive maintenance instructions; existing agents receive the tools and their guidance when their session next reopens.

Requires Paseo 0.15.4 or later on the daemon and app, with Paseo tools enabled for the agent's provider. Pins are stored on the daemon machine, separately for each workspace, and shared across its agents and connected clients. The plugin reads optional repository pin configuration and manages its own data files. It does not fetch the saved URLs. Data remains after uninstalling the plugin.

New pins start read. Agents must explain each meaningful update in a short message, shown beside a theme-colored accent line while unread in the menu and retained in chat history. Meaningful updates to existing pins flagged by agents show a dot over the resource icon and contribute to the Pins unread count. Open a link or use the acknowledgment controls to mark it read. Read state is shared across connected devices and preserved when upgrading. Pins saved before notifications were introduced migrate as read. Visible workspace controls and the open list refresh automatically. HTTP and HTTPS links are supported; file links are not yet supported. Preview addresses must be reachable from the device opening them.

After each agent turn, a compact chat block shows newly added pins and updates flagged for attention. Its heading collapses the whole group. It initially shows three entries; **Show all** expands the rest. Each entry preserves the destination captured during that turn. Opening it or using the block’s **Mark as read** action acknowledges only those captured updates, including collapsed entries. Newer updates stay unread. Stopped or failed turns still show successfully saved changes with **Turn interrupted**.

Pin changes and summary history are saved together on the daemon. Older data files migrate automatically without notifying or backfilling old changes. A missing chat row is recovered when the plugin next connects to Paseo or the conversation is opened; delayed recovery is labeled with the original turn time. Keep these data files when upgrading: removing a current pin does not remove its historical links.

Agents can organize related links under optional section headings. Unsectioned pins stay at the top, empty sections are hidden, and removing a section keeps its pins. Chat summaries remain flat.


Use **Refresh pins** to discover useful links from recent workspace work and maintain the list, even when it is empty. No saved profile is required. Automatic follows the provider and model of the workspace’s most recently active eligible agent. If none is available, it uses an available provider and model from Paseo’s catalog. Other settings use provider defaults. An optional saved profile in Pins settings overrides this for every workspace on the host. A separate agent reviews recent conversations, uses repository evidence only for specific context gaps, and is instructed to change only pins and sections. Recent conversation text is sent to the selected agent provider. The plugin saves concise results and source references, not a second copy of the conversations.

Refresh runs for up to five minutes and can be canceled from the menu. Progress and change totals appear beneath the toolbar; only errors expand to show troubleshooting details. Completed changes are retained on cancellation or failure; uncertain resources remain pinned. If inspection needs permission, refresh finishes with a limitation. The worker is archived afterward. New discoveries start read, while meaningful updates to existing pins may notify with a message.

Use the pin-shaped **Keep** control to prevent agents and refresh from removing a resource. A filled pin means kept. Agents can still update its title, destination, and section. **Mark as read** sits beside the update message and acts independently.

A repository can define static links in `.paseo/pins.json`. They appear automatically alongside agent-managed pins, with a gear and **Repo** source label instead of Keep. The file controls their definitions; agents can still notify meaningful updates. Config changes apply quietly, and an invalid file preserves the last valid list with an explanation. Variable substitution is not supported yet.
