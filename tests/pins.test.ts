import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { pinGuidance, withPinGuidance } from "../server/guidance.ts";
import { PinStore } from "../server/store.ts";
import { createPinTools } from "../server/tools.ts";
import { pinUrlSchema, upsertPinSchema } from "../shared/pins.ts";

const preview = {
  key: "dev-preview",
  title: "Dev preview",
  url: "https://example.com/preview?q=one#demo",
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-pins-test-"));
  let tick = 0;
  const store = new PinStore(directory, () =>
    new Date(Date.UTC(2026, 10, 11, 0, 0, tick++)).toISOString(),
  );
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, directory };
}

test("updates preserve order and creation time; repeated operations are idempotent", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.list("a"), []);
  const first = await store.upsert("a", preview);
  await store.upsert("a", { ...preview, key: "review-pr", title: "Review" });
  const noOp = await store.upsert("a", { ...preview, title: "  Dev preview  " });
  assert.equal(noOp.status, "unchanged");
  assert.deepEqual(noOp.pin, first.pin);
  const updated = await store.upsert("a", { ...preview, url: "https://example.com/new" });
  assert.equal(updated.status, "updated");
  assert.equal(updated.pin.createdAt, first.pin.createdAt);
  assert.notEqual(updated.pin.updatedAt, first.pin.updatedAt);
  assert.deepEqual(
    (await store.list("a")).map((pin) => pin.key),
    ["dev-preview", "review-pr"],
  );
  assert.equal((await store.remove("a", "dev-preview")).status, "removed");
  assert.equal((await store.remove("a", "dev-preview")).status, "absent");
});

test("workspace isolation and a fresh store reading durable data", async (t) => {
  const { store, directory } = await fixture(t);
  await store.upsert("workspace-a", preview);
  await store.upsert("workspace-b", { ...preview, title: "Other workspace" });
  await store.close();
  const reopened = new PinStore(directory);
  assert.equal((await reopened.list("workspace-a"))[0]?.title, preview.title);
  assert.equal((await reopened.list("workspace-b"))[0]?.title, "Other workspace");
  assert.deepEqual(await reopened.list("workspace-c"), []);
  await reopened.close();
});

test("pin types default, persist, preserve on omission, and support type-only updates", async (t) => {
  const { store, directory } = await fixture(t);
  const initial = await store.upsert("a", preview);
  assert.equal(initial.pin.type, "link");
  const typed = await store.upsert("a", { ...preview, type: "app" });
  assert.equal(typed.status, "updated");
  assert.equal(typed.pin.createdAt, initial.pin.createdAt);
  assert.notEqual(typed.pin.updatedAt, initial.pin.updatedAt);
  assert.equal((await store.upsert("a", preview)).status, "unchanged");
  assert.equal((await store.upsert("a", { ...preview, title: "New title" })).pin.type, "app");
  const reopened = new PinStore(directory);
  assert.equal((await reopened.list("a"))[0]?.type, "app");
  await reopened.close();
  assert.equal((await store.upsert("a", { ...preview, type: "link" })).pin.type, "link");
  assert.equal(upsertPinSchema.safeParse({ ...preview, type: "arbitrary-icon" }).success, false);
  assert.equal(upsertPinSchema.safeParse({ ...preview, icon: "Globe" }).success, false);
});

test("legacy pins without a type remain readable and can be updated", async (t) => {
  const { store } = await fixture(t);
  const file = store.filePath("a");
  await mkdir(path.dirname(file), { recursive: true });
  const timestamp = "2026-11-10T00:00:00.000Z";
  const original = JSON.stringify({
    version: 1,
    workspaceId: "a",
    pins: [{ ...preview, createdAt: timestamp, updatedAt: timestamp }],
  });
  await writeFile(file, original);
  assert.equal((await store.list("a"))[0]?.type, "link");
  assert.equal(await readFile(file, "utf8"), original);
  const updated = await store.upsert("a", { ...preview, type: "docs" });
  assert.equal(updated.pin.createdAt, timestamp);
  assert.equal((await store.list("a"))[0]?.type, "docs");
});

test("concurrent changes do not lose distinct pins; shutdown drains writes", async (t) => {
  const { store } = await fixture(t);
  const operations = Array.from({ length: 20 }, (_, i) =>
    store.upsert("a", { ...preview, key: `pin-${i}` }),
  );
  const close = store.close();
  await Promise.all(operations);
  await close;
  assert.equal((await store.list("a")).length, 20);
  await assert.rejects(store.upsert("a", preview), /shutting down/);
});

test("same-key concurrent updates commit in call order", async (t) => {
  const { store } = await fixture(t);
  await Promise.all([
    store.upsert("a", preview),
    store.upsert("a", { ...preview, title: "Latest" }),
  ]);
  assert.equal((await store.list("a"))[0]?.title, "Latest");
});

test("rejects unsafe URLs while preserving valid destinations exactly", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/test",
    "ftp://example.com",
    "https://user:pass@example.com",
    "//example.com",
    "https:example.com",
    "https://example.com\n",
    "http://",
    "https://example.com/\\evil",
  ]) {
    assert.equal(pinUrlSchema.safeParse(url).success, false, url);
  }
  for (const url of [
    preview.url,
    "http://localhost:3000",
    "https://example.com/%2f?x=1&x=2#fragment",
  ]) {
    assert.equal(pinUrlSchema.parse(url), url);
  }
});

test("corrupt or mismatched data is preserved on reads and mutations", async (t) => {
  const { store } = await fixture(t);
  const file = store.filePath("a");
  await mkdir(path.dirname(file), { recursive: true });
  for (const original of [
    "{broken",
    JSON.stringify({ version: 2, workspaceId: "a", pins: [] }),
    JSON.stringify({ version: 1, workspaceId: "b", pins: [] }),
  ]) {
    await writeFile(file, original);
    await assert.rejects(store.list("a"), /preserved/);
    await assert.rejects(store.upsert("a", preview), /preserved/);
    assert.equal(await readFile(file, "utf8"), original);
  }
  // A failed operation must not poison the mutation queue.
  await rm(file);
  assert.equal((await store.upsert("a", preview)).status, "created");
});

test("failed writes report failure and keep the previously saved list", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("a", preview);
  const directory = path.dirname(store.filePath("a"));
  await chmod(directory, 0o500);
  try {
    await assert.rejects(
      store.upsert("a", { ...preview, title: "Should not save" }),
      /Could not save/,
    );
    assert.equal((await store.list("a"))[0]?.title, preview.title);
  } finally {
    await chmod(directory, 0o700);
  }
  assert.equal((await store.upsert("a", { ...preview, title: "Recovered" })).status, "updated");
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".tmp")).length, 0);
});

test("a canceled mutation does not save", async (t) => {
  const { store } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.upsert("a", preview, controller.signal), /canceled/);
  assert.deepEqual(await store.list("a"), []);
});

test("mixed batches report each change, preserve other pins, and return the committed list", async (t) => {
  const { store } = await fixture(t);
  const original = await store.upsert("a", { ...preview, type: "app" });
  await store.upsert("a", { ...preview, key: "unchanged" });
  await store.upsert("a", { ...preview, key: "obsolete" });
  await store.upsert("a", { ...preview, key: "another-agent" });
  const batch = {
    upsert: [
      { ...preview, title: "Updated preview" },
      { ...preview, key: "unchanged" },
      { ...preview, key: "new-guide", type: "docs" as const },
    ],
    remove: ["obsolete", "already-gone"],
  };
  const result = await store.apply("a", batch);
  assert.deepEqual(
    result.upsert.map((entry) => entry.status),
    ["updated", "unchanged", "created"],
  );
  assert.deepEqual(
    result.remove.map((entry) => entry.status),
    ["removed", "absent"],
  );
  assert.deepEqual(result.remove[1], { status: "absent", key: "already-gone" });
  assert.deepEqual(
    result.pins.map((pin) => pin.key),
    ["dev-preview", "unchanged", "another-agent", "new-guide"],
  );
  assert.equal(result.pins[0]?.type, "app");
  assert.equal(result.pins[0]?.createdAt, original.pin.createdAt);
  assert.notEqual(result.pins[0]?.updatedAt, original.pin.updatedAt);
  assert.deepEqual(result.pins, await store.list("a"));
  const saved = await readFile(store.filePath("a"), "utf8");
  const repeated = await store.apply("a", batch);
  assert.ok(repeated.upsert.every((entry) => entry.status === "unchanged"));
  assert.ok(repeated.remove.every((entry) => entry.status === "absent"));
  assert.deepEqual(repeated.pins, result.pins);
  assert.equal(await readFile(store.filePath("a"), "utf8"), saved);
});

test("invalid or conflicting batches reject everything before writing", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("a", preview);
  const saved = await readFile(store.filePath("a"), "utf8");
  for (const batch of [
    {},
    { upsert: [], remove: [] },
    { upsert: [preview, { ...preview, title: "Duplicate" }] },
    { remove: [preview.key, preview.key] },
    { upsert: [preview], remove: [preview.key] },
    {
      upsert: [
        { ...preview, key: "valid" },
        { ...preview, url: "javascript:alert(1)" },
      ],
      remove: [preview.key],
    },
    { remove: [preview.key, "INVALID KEY"] },
    { upsert: Array.from({ length: 101 }, (_, index) => ({ ...preview, key: `pin-${index}` })) },
    { remove: Array.from({ length: 101 }, (_, index) => `pin-${index}`) },
  ]) {
    await assert.rejects(async () => store.apply("a", batch));
    assert.equal(await readFile(store.filePath("a"), "utf8"), saved);
  }
});

test("batch write failures and cancellation preserve the whole previous list", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("a", preview);
  const file = store.filePath("a");
  const saved = await readFile(file, "utf8");
  const batch = { upsert: [{ ...preview, key: "replacement" }], remove: [preview.key] };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.apply("a", batch, controller.signal), /canceled/);
  assert.equal(await readFile(file, "utf8"), saved);
  await chmod(path.dirname(file), 0o500);
  try {
    await assert.rejects(store.apply("a", batch), /Could not save/);
    assert.equal(await readFile(file, "utf8"), saved);
    // No-op batches still succeed when writes are unavailable.
    assert.equal((await store.apply("a", { upsert: [preview] })).upsert[0]?.status, "unchanged");
  } finally {
    await chmod(path.dirname(file), 0o700);
  }
  assert.deepEqual(
    (await store.apply("a", batch)).pins.map((pin) => pin.key),
    ["replacement"],
  );
});

test("batches share the single-pin queue and retain concurrent changes", async (t) => {
  const { store } = await fixture(t);
  const first = store.upsert("a", preview);
  const batch = store.apply("a", {
    upsert: [
      { ...preview, title: "Batch title" },
      { ...preview, key: "guide" },
    ],
  });
  const later = store.upsert("a", { ...preview, key: "another-agent" });
  const remove = store.remove("a", "guide");
  const otherWorkspace = store.apply("b", { upsert: [{ ...preview, key: "isolated" }] });
  await store.close();
  await Promise.all([first, later, remove, otherWorkspace]);
  assert.deepEqual(
    (await batch).pins.map((pin) => pin.key),
    ["dev-preview", "guide"],
  );
  const final = await store.list("a");
  assert.deepEqual(
    final.map((pin) => pin.key),
    ["dev-preview", "another-agent"],
  );
  assert.equal(final[0]?.title, "Batch title");
  assert.deepEqual(
    (await store.list("b")).map((pin) => pin.key),
    ["isolated"],
  );
  await assert.rejects(store.apply("a", { remove: [preview.key] }), /shutting down/);
});

test("agent tools use caller workspace and handle a complete pin lifecycle", async (t) => {
  const { store } = await fixture(t);
  const tools = createPinTools(store);
  const context = (workspaceId: string | null) =>
    ({
      agent: {
        id: "test-agent",
        workspaceId,
        parentAgentId: null,
        provider: "codex",
        cwd: "/tmp",
        title: "Test",
      },
      signal: new AbortController().signal,
    }) as AgentToolContext;
  const run = (name: string, input: unknown, workspaceId: string | null = "a") => {
    const tool = tools.find((tool) => tool.name === name);
    assert.ok(tool, `Missing tool: ${name}`);
    return tool.execute(tool.input.parse(input), context(workspaceId));
  };
  await run("pins_upsert", { ...preview, type: "app" });
  await run("pins_upsert", { ...preview, title: "Updated" });
  assert.equal((await store.list("a"))[0]?.title, "Updated");
  assert.equal((await store.list("a"))[0]?.type, "app");
  assert.deepEqual((await run("pins_list", {}, "b")).structuredContent, { pins: [] });
  await assert.rejects(async () => run("pins_list", {}, null), /require a Paseo workspace/);
  assert.throws(() => run("pins_upsert", { ...preview, workspaceId: "b" }));
  await run("pins_remove", { key: preview.key });
  assert.deepEqual((await run("pins_list", {})).structuredContent, { pins: [] });
  const batch = await run("pins_apply", { upsert: [preview], remove: ["absent"] });
  assert.deepEqual(batch.structuredContent, {
    upsert: [{ status: "created", pin: (await store.list("a"))[0] }],
    remove: [{ status: "absent", key: "absent" }],
    pins: await store.list("a"),
  });
  assert.deepEqual(await store.list("b"), []);
  assert.throws(() => run("pins_apply", { remove: [preview.key], workspaceId: "b" }));
  await assert.rejects(
    async () => run("pins_apply", { remove: [preview.key] }, null),
    /require a Paseo workspace/,
  );
  assert.throws(() => run("pins_apply", { upsert: [preview], remove: [preview.key] }));
  assert.ok(tools.every((tool) => tool.description.includes(pinGuidance)));
});

test("new-agent instructions preserve the existing prompt and append once", () => {
  const combined = withPinGuidance("Existing instructions.");
  assert.ok(combined.startsWith("Existing instructions.\n\n"));
  assert.ok(combined.includes(pinGuidance));
  assert.equal(withPinGuidance(combined), combined);
  assert.ok(withPinGuidance().includes(pinGuidance));
});
