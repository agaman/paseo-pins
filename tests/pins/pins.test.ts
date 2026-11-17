import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { pinGuidance, withPinGuidance } from "../../server/guidance/pins.ts";
import { PinStore } from "../../server/store.ts";
import { PinTurns } from "../../server/summaries/turns";
import { createPinTools } from "../../server/tools.ts";
import { pinSnapshot } from "../../shared/pin-rpc.ts";
import { isUnread, pinUrlSchema, upsertPinSchema } from "../../shared/pins.ts";

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
    JSON.stringify({ version: 99, workspaceId: "a", pins: [] }),
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
  const turns = new PinTurns(store);
  const tools = createPinTools(store, turns);
  t.after(() => turns.close());
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
      paseo: {
        agents: {
          ref: () => ({
            refresh: async () => ({
              agent: {
                workspaceId,
                activeTurn: { turnId: "tool-turn", startedAt: "2026-11-12T00:00:00.000Z" },
              },
            }),
          }),
        },
      },
      signal: new AbortController().signal,
    }) as unknown as AgentToolContext;
  const run = (name: string, input: unknown, workspaceId: string | null = "a") => {
    const tool = tools.find((tool) => tool.name === name);
    assert.ok(tool, `Missing tool: ${name}`);
    return tool.execute(tool.input.parse(input), context(workspaceId));
  };
  await run("pins_upsert", { ...preview, type: "app" });
  await run("pins_upsert", { ...preview, title: "Updated" });
  assert.equal((await store.list("a"))[0]?.title, "Updated");
  assert.equal((await store.list("a"))[0]?.type, "app");
  assert.deepEqual((await run("pins_list", {}, "b")).structuredContent, {
    pins: [],
    sections: [],
    unreadCount: 0,
    config: { loaded: false, error: null },
  });
  await assert.rejects(async () => run("pins_list", {}, null), /require a Paseo workspace/);
  assert.throws(() => run("pins_upsert", { ...preview, workspaceId: "b" }));
  await run("pins_remove", { key: preview.key });
  assert.deepEqual((await run("pins_list", {})).structuredContent, {
    pins: [],
    sections: [],
    unreadCount: 0,
    config: { loaded: false, error: null },
  });
  const batch = await run("pins_apply", { upsert: [preview], remove: ["absent"] });
  assert.deepEqual(batch.structuredContent, {
    upsert: [{ status: "created", notified: false, pin: (await store.list("a"))[0] }],
    remove: [{ status: "absent", key: "absent" }],
    notify: [],
    sectionResults: { upsert: [], remove: [] },
    ...pinSnapshot(await store.list("a")),
  });
  assert.deepEqual(await store.list("b"), []);
  const attention = { ...preview, notify: { id: "tool-event", reason: "Ready to review" } };
  const notified = await run("pins_upsert", attention);
  assert.deepEqual(notified.structuredContent, {
    status: "updated",
    notified: true,
    pin: (await store.list("a"))[0],
    ...(await store.snapshot("a")),
  });
  const repeated = await run("pins_upsert", attention);
  assert.deepEqual(repeated.structuredContent, {
    status: "unchanged",
    notified: false,
    pin: (await store.list("a"))[0],
    ...(await store.snapshot("a")),
  });
  assert.ok(!tools.some((tool) => tool.name.includes("acknowledge")));
  assert.throws(() => run("pins_apply", { remove: [preview.key], workspaceId: "b" }));
  await assert.rejects(
    async () => run("pins_apply", { remove: [preview.key] }, null),
    /require a Paseo workspace/,
  );
  assert.throws(() => run("pins_apply", { upsert: [preview], remove: [preview.key] }));
  await run("pins_apply", {
    sections: { upsert: [{ key: "preview", title: "Preview" }] },
    upsert: [{ ...preview, section: "preview" }],
  });
  const grouped = await store.snapshot("a");
  assert.deepEqual((await run("pins_list", {})).structuredContent, grouped);
  assert.equal(grouped.pins[0].section, "preview");
  assert.equal(grouped.unreadCount, 1);
  await run("pins_upsert", preview);
  assert.equal((await store.list("a"))[0].section, "preview");
  await run("pins_apply", { sections: { remove: ["preview"] } });
  assert.equal((await store.list("a"))[0].section, null);
  assert.ok(tools.every((tool) => tool.description.includes(pinGuidance)));
});

test("new-agent instructions preserve the existing prompt and append once", () => {
  const combined = withPinGuidance("Existing instructions.");
  assert.ok(combined.startsWith("Existing instructions.\n\n"));
  assert.ok(combined.includes(pinGuidance));
  assert.equal(withPinGuidance(combined), combined);
  assert.ok(withPinGuidance().includes(pinGuidance));
  const upgraded = withPinGuidance(
    "Existing instructions.\n\n[paseo-pins guidance v1]\nOld guidance\n[/paseo-pins guidance]",
  );
  assert.ok(upgraded.startsWith("Existing instructions."));
  assert.ok(upgraded.includes(pinGuidance));
  assert.ok(!upgraded.includes("Old guidance"));
});

test("legacy pins start read, migrate lazily, and preserve resource timestamps", async (t) => {
  const { store } = await fixture(t);
  const file = store.filePath("a");
  await mkdir(path.dirname(file), { recursive: true });
  const timestamp = "2026-11-10T00:00:00.000Z";
  const old = { ...preview, type: "app", createdAt: timestamp, updatedAt: timestamp };
  const source = JSON.stringify({ version: 1, workspaceId: "a", pins: [old] });
  await writeFile(file, source);
  const pins = await store.list("a");
  assert.equal(pinSnapshot(pins).unreadCount, 0);
  assert.equal(pins[0]?.attention, null);
  assert.equal(await readFile(file, "utf8"), source);
  assert.equal((await store.upsert("a", preview)).status, "unchanged");
  assert.equal(await readFile(file, "utf8"), source);
  await store.upsert("a", { ...preview, key: "new-pin" });
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 8);
  assert.deepEqual((await store.list("a"))[0], {
    ...old,
    instanceId: `legacy:${old.key}:${old.createdAt}`,
    kept: false,
    source: "agent",
    section: null,
    attention: null,
    readAttentionToken: null,
    consumedNotificationIds: [],
  });
});

function acknowledgment(pin: Awaited<ReturnType<PinStore["upsert"]>>["pin"]) {
  assert.ok(pin.attention);
  return { key: pin.key, attentionToken: pin.attention.token };
}

test("meaningful events notify once, including retries after acknowledgment and newer events", async (t) => {
  const { store, directory } = await fixture(t);
  await store.upsert("a", preview);
  const first = await store.upsert("a", { ...preview, notify: { id: "build-a", reason: "Ready" } });
  assert.equal(first.notified, true);
  assert.equal(isUnread(first.pin), true);
  assert.equal(first.pin.attention?.reason, "Ready");
  assert.equal("notify" in first.pin, false);
  const ack = await store.acknowledge("a", [acknowledgment(first.pin)]);
  assert.equal(ack.unreadCount, 0);
  assert.equal(ack.pins[0]?.updatedAt, first.pin.updatedAt);
  const retry = await store.upsert("a", {
    ...preview,
    notify: { id: "build-a", reason: "Ready to review" },
  });
  assert.equal(retry.status, "unchanged");
  assert.equal(retry.notified, false);
  const routine = await store.upsert("a", {
    ...preview,
    url: "https://example.com/new",
    type: "docs",
  });
  assert.equal(routine.notified, false);
  assert.equal(isUnread(routine.pin), false);
  const next = await store.upsert("a", {
    ...preview,
    url: routine.pin.url,
    notify: { id: "build-b", reason: "Ready to review" },
  });
  assert.equal(next.status, "updated");
  assert.equal(next.notified, true);
  const oldEvent = await store.upsert("a", {
    ...preview,
    url: routine.pin.url,
    notify: { id: "build-a", reason: "Ready to review" },
  });
  assert.equal(oldEvent.notified, false);
  assert.deepEqual(oldEvent.pin.attention, next.pin.attention);
  assert.equal(pinSnapshot(await store.list("a")).unreadCount, 1);
  await store.acknowledge("a", [acknowledgment(next.pin)]);
  const reopened = new PinStore(directory);
  t.after(() => reopened.close());
  assert.equal(isUnread((await reopened.list("a"))[0]), false);
  assert.equal(
    (
      await reopened.upsert("a", {
        ...preview,
        notify: { id: "build-a", reason: "Ready to review" },
      })
    ).notified,
    false,
  );
});

test("snapshot acknowledgments cannot clear concurrent updates or recreated keys", async (t) => {
  const { store } = await fixture(t);
  const first = await unreadPin(store, preview);
  const second = await unreadPin(store, { ...preview, key: "other" });
  const entries = [acknowledgment(first.pin), acknowledgment(second.pin)];
  const newer = store.upsert("a", {
    ...preview,
    notify: { id: "newer", reason: "Ready to review" },
  });
  const marked = store.acknowledge("a", entries);
  const extra = unreadPin(store, { ...preview, key: "unrelated" });
  await Promise.all([newer, marked, extra]);
  assert.deepEqual(
    (await marked).results.map((result) => result.status),
    ["stale", "acknowledged"],
  );
  assert.equal((await marked).unreadCount, 1);
  const repeated = await store.acknowledge("a", entries);
  assert.deepEqual(
    repeated.results.map((result) => result.status),
    ["stale", "already-read"],
  );
  assert.equal(repeated.unreadCount, 2);
  assert.equal(repeated.pins[1]?.updatedAt, second.pin.updatedAt);
  await store.remove("a", preview.key);
  assert.equal((await store.acknowledge("a", [entries[0]])).results[0]?.status, "absent");
  const recreated = await unreadPin(store, preview);
  assert.notEqual(recreated.pin.attention?.token, first.pin.attention?.token);
  assert.equal((await store.acknowledge("a", [entries[0]])).results[0]?.status, "stale");
  const retained = (await store.list("a")).find((pin) => pin.key === preview.key);
  assert.ok(retained);
  assert.equal(isUnread(retained), true);
  assert.equal(
    (await store.acknowledge("b", [acknowledgment(recreated.pin)])).results[0]?.status,
    "absent",
  );
});

test("failed notifications and acknowledgments preserve state and do not consume event IDs", async (t) => {
  const { store } = await fixture(t);
  const first = await unreadPin(store, preview);
  const file = store.filePath("a");
  const original = await readFile(file, "utf8");
  const entry = acknowledgment(first.pin);
  const update = { ...preview, notify: { id: "retry-me", reason: "Ready to review" } };
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(store.upsert("a", update, canceled.signal), /canceled/);
  await assert.rejects(store.acknowledge("a", [entry], canceled.signal), /canceled/);
  await assert.rejects(async () => store.acknowledge("a", [entry, entry]));
  await assert.rejects(async () => store.acknowledge("a", []));
  await assert.rejects(async () =>
    store.acknowledge("a", [{ ...entry, attentionToken: "invalid" }]),
  );
  await chmod(path.dirname(file), 0o500);
  try {
    await assert.rejects(store.upsert("a", update), /Could not save/);
    await assert.rejects(store.acknowledge("a", [entry]), /Could not save/);
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await chmod(path.dirname(file), 0o700);
  }
  assert.equal((await store.upsert("a", update)).notified, true);
});

test("v2 metadata is strict and malformed documents remain untouched", async (t) => {
  const { store } = await fixture(t);
  const { pin } = await store.upsert("a", preview);
  const file = store.filePath("a");
  for (const fields of [
    { attention: { token: "bad", notifiedAt: pin.updatedAt } },
    { attention: undefined },
    { readAttentionToken: undefined },
    { consumedNotificationIds: ["same", "same"] },
    { notify: { id: "unapplied", reason: "Ready to review" } },
  ]) {
    const { instanceId: _instanceId, section: _section, ...v2Pin } = pin;
    const source = JSON.stringify({
      version: 2,
      workspaceId: "a",
      pins: [{ ...v2Pin, ...fields }],
    });
    await writeFile(file, source);
    await assert.rejects(store.list("a"), /preserved/);
    await assert.rejects(store.upsert("a", preview), /preserved/);
    assert.equal(await readFile(file, "utf8"), source);
  }
});

test("notification inputs are bounded, cannot acknowledge, and batch statuses include attention", async (t) => {
  const { store } = await fixture(t);
  for (const notify of [
    { id: " " },
    { id: "x".repeat(129) },
    { id: "a", reason: "" },
    { id: "a", reason: "x".repeat(241) },
    { id: "a", read: true },
  ]) {
    assert.equal(upsertPinSchema.safeParse({ ...preview, notify }).success, false);
  }
  assert.equal(upsertPinSchema.safeParse({ ...preview, readAttentionToken: null }).success, false);
  const first = await store.upsert("a", preview);
  const result = await store.apply("a", {
    upsert: [
      { ...preview, notify: { id: " update ", reason: "Ready to review" } },
      { ...preview, key: "new" },
    ],
  });
  assert.deepEqual(
    result.upsert.map(({ status, notified }) => ({ status, notified })),
    [
      { status: "updated", notified: true },
      { status: "created", notified: false },
    ],
  );
  assert.equal(result.unreadCount, 1);
  assert.notEqual(result.pins[0]?.attention?.token, first.pin.attention?.token);
  assert.deepEqual(result.pins[0]?.consumedNotificationIds, ["update"]);
  assert.equal((await store.apply("a", { remove: [preview.key] })).unreadCount, 0);
});

test("mark all accepts more than 100 displayed pins", async (t) => {
  const { store } = await fixture(t);
  await store.apply("a", {
    upsert: Array.from({ length: 100 }, (_, i) => ({ ...preview, key: `pin-${i}` })),
  });
  await store.apply("a", {
    upsert: Array.from({ length: 100 }, (_, i) => ({
      ...preview,
      key: `pin-${i}`,
      notify: { id: "bulk-update", reason: "Ready to review" },
    })),
  });
  await unreadPin(store, preview);
  const entries = (await store.list("a")).map(acknowledgment);
  const result = await store.acknowledge("a", entries);
  assert.equal(result.results.length, 101);
  assert.equal(result.unreadCount, 0);
});

async function unreadPin(store: PinStore, input: typeof preview) {
  await store.upsert("a", input);
  return store.upsert("a", {
    ...input,
    notify: { id: "fixture-update", reason: "Ready to review" },
  });
}

test("new pins start read, ignore creation notifications and keep retries silent", async (t) => {
  const { store, directory } = await fixture(t);
  const first = await store.upsert("a", preview);
  assert.equal(first.notified, false);
  assert.equal(first.pin.attention, null);
  assert.equal(isUnread(first.pin), false);
  const input = {
    ...preview,
    key: "with-notify",
    notify: { id: "creation", reason: "Not an update" },
  };
  const created = await store.upsert("a", input);
  assert.equal(created.notified, false);
  assert.equal(created.pin.attention, null);
  assert.deepEqual(created.pin.consumedNotificationIds, ["creation"]);
  const reopened = new PinStore(directory);
  t.after(() => reopened.close());
  const retried = await reopened.upsert("a", input);
  assert.equal(retried.status, "unchanged");
  assert.equal(retried.notified, false);
  assert.equal(pinSnapshot(await reopened.list("a")).unreadCount, 0);
  const updated = await reopened.upsert("a", {
    ...input,
    notify: { id: "actual-update", reason: "New deployment" },
  });
  assert.equal(updated.notified, true);
  assert.equal(isUnread(updated.pin), true);
  assert.equal(updated.pin.attention?.reason, "New deployment");
});

test("notifications require a message before any batch changes, while legacy attention remains readable", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("a", preview);
  const file = store.filePath("a");
  const before = await readFile(file, "utf8");
  for (const reason of [undefined, "", "   ", null, 42]) {
    const input = JSON.parse(
      JSON.stringify({
        upsert: [
          { ...preview, key: "must-not-be-created" },
          { ...preview, notify: { id: "invalid-message", reason } },
        ],
      }),
    );
    assert.throws(() => store.apply("a", input));
    assert.equal(await readFile(file, "utf8"), before);
  }
  const result = await store.upsert("a", {
    ...preview,
    notify: { id: "ready", reason: "  Mobile navigation is ready to try.  " },
  });
  assert.equal(result.pin.attention?.reason, "Mobile navigation is ready to try.");
  const legacy = JSON.parse(await readFile(file, "utf8"));
  delete legacy.pins[0].attention.reason;
  await writeFile(file, JSON.stringify(legacy));
  const [pin] = await store.list("a");
  assert.equal(pin.attention?.reason, undefined);
  assert.equal(isUnread(pin), true);
});
