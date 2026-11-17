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

GitHub Actions runs that gate on Node.js 22 and 24 for pull requests and pushes to `main`. It also runs `npm run check:distribution`, which checks that the manifest, runtime entries, transitive local imports, and declared local images are tracked regular files. Stage new distribution files before running this check locally. Remote image availability and live Paseo behavior still need manual verification.

After the first successful Actions run, configure the `main` branch ruleset to require `Checks (Node 22)` and `Checks (Node 24)` before merging. The workflow uses read-only permissions and does not publish releases. Failed runs can be rerun from Actions; newer commits cancel superseded runs.

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

## Releases

Releases use annotated Git tags and GitHub Releases. The package remains private; there is no npm publication. `package.json` is the version source, and `package-lock.json` must agree. Only stable versions such as `0.1.0` are supported.

Before releasing, check the manifest's minimum Paseo version, metadata, README, and screenshots. Test a fresh Git installation of the intended commit on an isolated daemon. Community registry submission remains a separate manual step.

1. If the current version already has a tag (including a failed release), run `npm version patch --no-git-tag-version` (or `minor` / `major`). Otherwise use the current version. The version command updates both package files without creating a tag.
2. Review the changes, run `npm run check` and `npm run check:distribution`, then commit and push through the normal process. Wait for CI to pass on `main`.
3. From a clean `main`, preview the release:

   ```sh
   npm run release -- --dry-run
   ```

4. Create and push the version tag:

   ```sh
   npm run release
   ```

The script requires local `main` to match the current `origin` main branch. The dry run reads the remote but makes no changes. Existing tags are never replaced. If a push fails, fix the connection or permission issue and rerun the command; it reuses a matching local annotated tag.

Pushing `v*` starts the Release workflow. It checks that the tag is annotated, matches both package versions, and points to a commit on `origin/main`, then runs the same Node.js 22/24 CI matrix. After all checks pass, a separate job with `contents: write` creates a GitHub release with generated notes. GitHub provides source archives automatically; no build artifact or npm credentials are needed.

If Actions fails, rerun the failed jobs from GitHub Actions. Repeating the local command will not retrigger an already-pushed tag. A workflow retry leaves an existing GitHub release unchanged, including any edited notes. Fix code failures in a new version rather than moving a published tag.

Historical plans and validation notes remain in Git history.
