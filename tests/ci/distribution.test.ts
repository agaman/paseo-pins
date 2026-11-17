import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkDistribution } from "../../tools/ci/check-distribution";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "pins-distribution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (file: string, content: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  };
  const manifest = {
    id: "sample",
    requirements: { paseo: ">=0.15.4" },
    icon: "assets/icon.png",
    media: ["assets/menu.png"],
  };
  await write("paseo-plugin.json", JSON.stringify(manifest));
  await write("package.json", JSON.stringify({ name: "sample", version: "0.1.0" }));
  await write("LICENSE", "MIT");
  await write("README.md", "Sample");
  await write("assets/icon.png", "sample image");
  await write("assets/menu.png", "sample screenshot");
  await write("index.server.ts", 'export { contribute as default } from "./server/main.js";');
  await write("server/main.ts", 'import "zod"; export function contribute() {}');
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const stage = () => execFileSync("git", ["add", "--all"], { cwd: root });
  stage();
  return { root, write, stage, manifest };
}

test("distribution resolves transitive local imports from staged files without loading code", async (t) => {
  const { root, write, stage } = await fixture(t);
  await write("server/main.ts", 'export const contribute = () => import("../shared/value");');
  await write("shared/value.ts", 'throw new Error("Do not execute plugin code");');
  stage();
  assert.equal(checkDistribution(root), 9);
});

test("distribution rejects local-only media and runtime dependencies until tracked", async (t) => {
  const { root, write, manifest, stage } = await fixture(t);
  await write("assets/new.png", "new screenshot");
  await write("paseo-plugin.json", JSON.stringify({ ...manifest, media: ["assets/new.png"] }));
  assert.throws(() => checkDistribution(root), /not tracked.*assets\/new.png/);
  stage();
  await write("server/main.ts", 'import "../shared/local";');
  await write("shared/local.ts", "export const value = 1;");
  assert.throws(() => checkDistribution(root), /not tracked.*shared\/local.ts/);
  stage();
  assert.doesNotThrow(() => checkDistribution(root));
});

test("distribution rejects non-host imports even when they are type-only development dependencies", async (t) => {
  const { root, write } = await fixture(t);
  await write(
    "package.json",
    JSON.stringify({ devDependencies: { "@getpaseo/client": "0.15.4" } }),
  );
  await write(
    "server/main.ts",
    'import type { PaseoAgent } from "@getpaseo/client"; export type Agent = PaseoAgent;',
  );
  assert.throws(() => checkDistribution(root), /Non-host dependency @getpaseo\/client/);
  await write("server/main.ts", 'import "external-library";');
  assert.throws(() => checkDistribution(root), /Non-host dependency external-library/);
  await write(
    "server/main.ts",
    'import type { PluginServerContext } from "@getpaseo/plugin/server"; export type Context = PluginServerContext;',
  );
  assert.doesNotThrow(() => checkDistribution(root));
});

test("distribution rejects missing tracked files, unresolved imports and absent entries", async (t) => {
  const { root, write, stage } = await fixture(t);
  await rm(path.join(root, "assets/menu.png"));
  assert.throws(() => checkDistribution(root), /ENOENT/);
  await write("assets/menu.png", "restored");
  await write("server/main.ts", 'import "./missing";');
  assert.throws(() => checkDistribution(root), /Missing local import/);
  await rm(path.join(root, "index.server.ts"));
  stage();
  assert.throws(() => checkDistribution(root), /no tracked.*entry/);
});

test("distribution requires runtime implementations even when declarations are tracked", async (t) => {
  const { root, write, stage } = await fixture(t);
  await write("server/main.ts", 'import "./implementation.js";');
  await write("server/implementation.d.ts", "export declare const value: number;");
  stage();
  assert.throws(() => checkDistribution(root), /Missing local import/);
  await write("server/implementation.js", "export const value = 1;");
  assert.throws(() => checkDistribution(root), /not tracked.*implementation.js/);
  stage();
  assert.doesNotThrow(() => checkDistribution(root));
});

test("distribution accepts tracked declarations for explicit type-only imports", async (t) => {
  const { root, write, stage } = await fixture(t);
  await write("server/main.ts", 'import type { Value } from "./types.js"; export type { Value };');
  await write("server/types.d.ts", "export interface Value { name: string }");
  stage();
  assert.doesNotThrow(() => checkDistribution(root));
});

test("distribution rejects invalid metadata, escaping paths and symlinks", async (t) => {
  const { root, write, manifest, stage } = await fixture(t);
  await write("paseo-plugin.json", JSON.stringify({ ...manifest, requirements: {} }));
  assert.throws(() => checkDistribution(root), /paseo/);
  await write("paseo-plugin.json", JSON.stringify({ ...manifest, media: ["../outside.png"] }));
  assert.throws(() => checkDistribution(root), /outside the plugin/);
  await write("paseo-plugin.json", JSON.stringify(manifest));
  await rm(path.join(root, "assets/menu.png"));
  await symlink("icon.png", path.join(root, "assets/menu.png"));
  assert.throws(() => checkDistribution(root), /symlink/);
  stage();
  assert.throws(() => checkDistribution(root), /regular file/);
});
