# Pins

Pins keeps useful links within reach in each workspace. Open **Pins** in the workspace header to see previews, review requests, staging environments, and other resources your agents have saved. On compact layouts, Pins appears in the workspace menu.

Agents can list, add, update, and remove links, including multiple changes in one atomic batch. The plugin teaches them to reuse entries and remove resources known to be obsolete. Users click links to open them in their external browser. New agents receive maintenance instructions; existing agents receive the tools and their guidance when their session next reopens.

Requires Paseo 0.15.2 or later on the daemon and app, with Paseo tools enabled for the agent's provider. Pins are stored on the daemon machine, separately for each workspace, and shared across its agents and connected clients. The plugin reads and writes its own data files and does not fetch the saved URLs. Data remains after uninstalling the plugin.

The list refreshes while open. HTTP and HTTPS links are supported; file links are not yet supported. Preview addresses must be reachable from the device opening them.
