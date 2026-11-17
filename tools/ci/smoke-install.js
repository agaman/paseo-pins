import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

// Exercise the public CLI against committed files, never the development checkout.
const { values } = parseArgs({
  options: {
    cli: { type: "string", default: "paseo" },
    revision: { type: "string", default: "HEAD" },
    "git-ref": { type: "string" },
    "logs-dir": { type: "string" },
  },
});
const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "pins-smoke-"));
const daemonHome = path.join(scratch, "daemon");
const source = path.join(scratch, "source");
const logs = values["logs-dir"]
  ? path.resolve(values["logs-dir"])
  : await mkdtemp(path.join(tmpdir(), "pins-smoke-logs-"));
await mkdir(logs, { recursive: true });
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort(new Error(`Interrupted by ${signal}`)));
}

// Do not inherit the invoking agent's daemon selection or Node module resolution overrides.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("PASEO_") && !["NODE_PATH", "NODE_OPTIONS"].includes(key),
  ),
);
env.PASEO_PINS_DATA_DIR = path.join(scratch, "pins-data");
env.GIT_TERMINAL_PROMPT = "0";
const execute = promisify(execFile);
async function run(command, args, { timeout = 30_000, cleanup = false, cwd = scratch } = {}) {
  await appendFile(path.join(logs, "commands.log"), `\n${command} ${args.join(" ")}\n`);
  try {
    const result = await execute(command, args, {
      cwd,
      env,
      timeout,
      killSignal: "SIGKILL",
      signal: cleanup ? undefined : controller.signal,
      maxBuffer: 8 * 1024 * 1024,
    });
    await appendFile(path.join(logs, "commands.log"), result.stdout + result.stderr);
    return result.stdout.trim();
  } catch (error) {
    await appendFile(
      path.join(logs, "commands.log"),
      `${error.stdout ?? ""}${error.stderr ?? ""}\n${error.message}\n`,
    );
    throw error;
  }
}
const paseo = (args, options) => run(values.cli, [...args, "--home", daemonHome], options);
let started = false;
let cleanupFailed = false;
let pluginId;

async function requireRunning(expectedCommit) {
  const deadline = Date.now() + 30_000;
  do {
    const plugins = JSON.parse(await paseo(["plugin", "ls", pluginId, "--json"]));
    assert.equal(plugins.length, 1, "Expected exactly one installed plugin");
    const plugin = plugins[0];
    assert.equal(plugin.enabled, true, "Plugin must be enabled");
    assert.ok(!plugin.error, plugin.error);
    assert.notEqual(plugin.status, "failed", "Plugin failed to start");
    if (plugin.status === "running") {
      if (expectedCommit) {
        assert.equal(plugin.installation?.currentRevision, expectedCommit, "Wrong Git revision");
        assert.ok(plugin.path.startsWith(`${daemonHome}${path.sep}`), "Expected a managed clone");
      } else {
        assert.equal(plugin.path, source, "Expected the clean exported directory");
      }
      return;
    }
    await delay(500, undefined, { signal: controller.signal });
  } while (Date.now() < deadline);
  throw new Error("Plugin did not reach running within 30 seconds");
}

try {
  console.log(`Smoke-test logs: ${logs}`);
  const commit = await run("git", ["rev-parse", "--verify", `${values.revision}^{commit}`], {
    cwd: root,
  });
  const archive = path.join(scratch, "source.tar");
  await run("git", ["archive", "--format=tar", `--output=${archive}`, commit], { cwd: root });
  await mkdir(source);
  await run("tar", ["-xf", archive, "-C", source]);
  assert.ok(
    !(await readdir(source, { recursive: true })).some((file) =>
      file.split(path.sep).includes("node_modules"),
    ),
    "Export must not contain node_modules",
  );
  for (let parent = scratch; ; parent = path.dirname(parent)) {
    assert.ok(
      !(await readdir(parent)).includes("node_modules"),
      `Dependency leakage from ${parent}`,
    );
    if (parent === path.dirname(parent)) break;
  }
  const manifest = JSON.parse(await readFile(path.join(source, "paseo-plugin.json"), "utf8"));
  pluginId = manifest.id;
  const version = await run(values.cli, ["--version"]);
  assert.equal(
    manifest.requirements.paseo,
    `>=${version}`,
    "Use the minimum supported Paseo version",
  );
  await mkdir(daemonHome);
  await writeFile(
    path.join(daemonHome, "config.json"),
    JSON.stringify({
      version: 1,
      pluginsEnabled: true,
      daemon: {
        listen: path.join(scratch, "daemon.sock"),
        relay: { enabled: false },
        usage: { enabled: false },
      },
      features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
    }),
  );
  started = true; // Also attempt cleanup if startup only partially succeeds.
  await paseo(["daemon", "start", "--timeout", "60", "--json"], { timeout: 90_000 });
  await paseo(["plugin", "add", source, "--json"], { timeout: 180_000 });
  await requireRunning();
  await paseo(["plugin", "reload", pluginId, "--json"], { timeout: 90_000 });
  await delay(1_000, undefined, { signal: controller.signal });
  await requireRunning();
  console.log(`Clean directory install and reload passed: ${commit} on Paseo ${version}`);

  if (values["git-ref"]) {
    // Start this installation without the directory registration or its compiled bundle.
    await paseo(["plugin", "remove", pluginId, "--json"]);
    await paseo(["plugin", "add", "git:agaman/paseo-pins", "--ref", values["git-ref"], "--json"], {
      timeout: 180_000,
    });
    await requireRunning(commit);
    await paseo(["plugin", "reload", pluginId, "--json"], { timeout: 90_000 });
    await delay(1_000, undefined, { signal: controller.signal });
    await requireRunning(commit);
    console.log(`Git install and reload passed: ${values["git-ref"]} (${commit})`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      await paseo(["plugin", "logs", pluginId, "--json"], { cleanup: true, timeout: 15_000 });
    } catch {
      // The command transcript still captures compilation/startup failures.
    }
    try {
      await paseo(["daemon", "stop", "--force", "--timeout", "10", "--json"], {
        cleanup: true,
        timeout: 30_000,
      });
    } catch (error) {
      console.error(`Failed to stop smoke-test daemon at ${daemonHome}: ${error.message}`);
      process.exitCode = 1;
      cleanupFailed = true; // Retain its home so it can be stopped manually.
    }
    for (const file of await readdir(daemonHome)) {
      if (file.endsWith(".log")) await copyFile(path.join(daemonHome, file), path.join(logs, file));
    }
  }
  if (!cleanupFailed) await rm(scratch, { recursive: true, force: true });
  console.log(`Logs retained at ${logs}`);
}
