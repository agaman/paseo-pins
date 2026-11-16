# Contributing

Use Node.js 22 or later and Paseo 0.15.4 or later on the daemon and app.

```sh
npm ci
npm run hooks:install
npm run check
paseo plugin disable paseo-pins # Only if already installed
paseo plugin install /absolute/path/to/paseo-pins --id paseo-pins-dev
```

Enable plugins on the intended host first. The source path must exist on that host. The separate `paseo-pins-dev` ID avoids colliding with the GitHub installation, but both copies use the same workspace pin data, so keep only one enabled per daemon. After editing, run `paseo plugin reload paseo-pins-dev`, then check `paseo plugin ls` and `paseo plugin logs paseo-pins-dev`.

To return to the installed GitHub version, run `paseo plugin disable paseo-pins-dev`, then `paseo plugin enable paseo-pins`. To use an already-installed development copy again, disable `paseo-pins` and enable `paseo-pins-dev` instead of reinstalling it.

## Checks

`npm run check` runs lint, formatting, strict TypeScript, unused-code detection, duplication detection, and tests. The pre-commit hook runs the same gate. Install the hook in each clone; do not bypass it.

Use `npm run format` for formatting or `npm run fix` for Biome's safe fixes. For partially staged changes, ensure the staged content matches what you validated. Duplication checks exclude tests.

For UI changes, inspect desktop and compact layouts in light and dark themes. A compact browser preview does not establish native iOS or Android compatibility. Do focused checks during implementation, then complete the full gate after product review and before committing.

The [listing capture tool](tools/listing/README.md) regenerates sample-data screenshots from the current components. Its dependencies and browser installation are separate from the plugin.

## Source map

| Location | Purpose |
| --- | --- |
| `index.client.tsx`, `client/` | Workspace menu, settings, chat summaries |
| `index.server.ts`, `server/` | Agent tools, persistence, repository config, refresh workers |
| `shared/` | Schemas and RPC contracts |
| `tests/` | Deterministic behavior checks |
| `docs/` | User help and repository configuration |

Client code is grouped into `menu/`, `refresh/`, `summaries/`, and reusable `ui/` components. Server code groups refresh workers, summaries, and agent guidance separately; persistence and repository configuration remain at the server root. Tests follow the same feature groups, and `npm test` discovers them recursively.

In `shared/`, `pins.ts` defines pin models and tool inputs, `pin-rpc.ts` defines menu RPCs and snapshots, `pin-document.ts` handles stored documents and migrations, and `summaries.ts` owns summary models and RPCs. Repository state and refresh contracts have their own modules. Import directly from the owning module; keep shared code independent of client and server runtimes.

Use supported Paseo plugin APIs only. Do not patch Paseo, its SDK, or installed application, or depend on unsupported host internals. See [AGENTS.md](AGENTS.md).

Agent-tool contracts live in [`shared/pins.ts`](shared/pins.ts), with usage guidance in [`server/guidance/pins.ts`](server/guidance/pins.ts) and [`server/guidance/selection.ts`](server/guidance/selection.ts).

## Release preparation

Before publishing, check the manifest's minimum Paseo version, package metadata, README, and current screenshots. The registry reviewer can prepare the listing overview from the README and verified behavior. Run `npm pack --dry-run --ignore-scripts` and verify every runtime import and declared asset is included. Test the exact release artifact on an isolated daemon rather than relying on a development checkout's dependencies or data.

The package remains private until npm publication is explicitly prepared. Repository installation is available separately. Historical plans and validation notes remain in Git history.
