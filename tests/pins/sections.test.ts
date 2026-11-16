import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PinStore } from "../../server/store";
import { applyPinsSchema, type PinBatchInput } from "../../shared/pins";
import { groupPins } from "../../shared/sections";

const resource = { key: "preview", title: "Preview", url: "https://example.com" };
const review = { key: "review", title: "Review" };
const preview = { key: "preview", title: "Preview" };
const turn = { agentId: "agent", turnId: "turn", startedAt: "2026-11-12T00:00:00.000Z" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "pin-sections-"));
  const store = new PinStore(directory);
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return store;
}

test("sections and pins commit together, preserve canonical order, and hide empty definitions", async (t) => {
  const store = await fixture(t);
  const result = await store.apply("a", {
    sections: { upsert: [preview, review, { key: "empty", title: "Empty" }] },
    upsert: [
      resource,
      { ...resource, key: "b", section: "review" },
      { ...resource, key: "c", section: "preview" },
      { ...resource, key: "d", section: "review" },
    ],
  });
  assert.deepEqual(
    result.sectionResults.upsert.map((r) => r.status),
    ["created", "created", "created"],
  );
  const groups = groupPins(result.pins, result.sections);
  assert.deepEqual(
    groups.map((g) => g.section?.key ?? null),
    [null, "preview", "review"],
  );
  assert.deepEqual(
    groups.map((g) => g.pins.map((p) => p.key)),
    [["preview"], ["c"], ["b", "d"]],
  );
  const moved = await store.upsert("a", { ...resource, section: "review" });
  assert.deepEqual(
    groupPins(moved.pins, moved.sections)[1].pins.map((p) => p.key),
    ["preview", "b", "d"],
  );
  assert.equal((await store.upsert("a", resource)).pin.section, "review");
  assert.equal((await store.upsert("a", { ...resource, section: null })).pin.section, null);
  const renamed = await store.apply("a", {
    sections: { upsert: [{ ...preview, title: "  Environments  " }] },
  });
  assert.deepEqual(
    renamed.sections.map((s) => s.key),
    ["preview", "review", "empty"],
  );
  assert.equal(renamed.sections[0].title, "Environments");
  assert.equal(renamed.sectionResults.upsert[0].status, "updated");
  const before = await readFile(store.filePath("a"), "utf8");
  const noOp = await store.apply("a", {
    sections: {
      upsert: renamed.sections.map(({ key, title }) => ({ key, title })),
      remove: ["absent"],
    },
  });
  assert.ok(noOp.sectionResults.upsert.every((r) => r.status === "unchanged"));
  assert.equal(await readFile(store.filePath("a"), "utf8"), before);
  const removed = await store.apply("a", {
    sections: { remove: ["review"] },
    upsert: [{ ...resource, key: "b", section: "preview" }],
  });
  assert.deepEqual(
    removed.pins.map((p) => p.section),
    [null, "preview", "preview", null],
  );
  await store.apply("a", { sections: { upsert: [review] } });
  assert.equal((await store.list("a"))[3].section, null);
  assert.deepEqual((await store.snapshot("b")).sections, []);
});

test("invalid assignments, conflicting sections, cancellation and write failure are atomic", async (t) => {
  const store = await fixture(t);
  await store.apply("a", {
    sections: { upsert: [review] },
    upsert: [{ ...resource, section: "review" }],
  });
  const file = store.filePath("a"),
    original = await readFile(file, "utf8");
  const invalid: PinBatchInput[] = [
    {
      sections: { upsert: [preview] },
      upsert: [{ ...resource, section: "missing", notify: { id: "event", reason: "Test" } }],
    },
    { sections: { remove: ["review"] }, upsert: [{ ...resource, section: "review" }] },
    { sections: { upsert: [review, review] } },
    { sections: { upsert: [review], remove: ["review"] } },
    { sections: { upsert: [{ key: "bad", title: " " }] } },
    { sections: { upsert: [{ key: "bad", title: "x".repeat(81) }] } },
    {
      sections: {
        upsert: Array.from({ length: 101 }, (_, i) => ({ key: `s-${i}`, title: "Section" })),
      },
    },
    { sections: {} },
  ];
  for (const input of invalid) {
    await assert.rejects(async () => store.apply("a", input));
    assert.equal(await readFile(file, "utf8"), original);
  }
  assert.equal(
    applyPinsSchema.safeParse({
      sections: { upsert: [review] },
      upsert: [{ ...resource, key: "review" }],
    }).success,
    true,
  );
  const change = { sections: { remove: ["review"] } };
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(store.apply("a", change, canceled.signal), /canceled/);
  await chmod(path.dirname(file), 0o500);
  try {
    await assert.rejects(store.apply("a", change), /Could not save/);
  } finally {
    await chmod(path.dirname(file), 0o700);
  }
  assert.equal(await readFile(file, "utf8"), original);
});

test("section maintenance is silent, concurrent changes survive, and acknowledgment keeps groups", async (t) => {
  const store = await fixture(t);
  await store.upsert("a", resource);
  const notified = await store.upsert(
    "a",
    { ...resource, notify: { id: "event", reason: "Ready to review" } },
    undefined,
    turn,
  );
  await store.finalize("a", turn.agentId, turn.turnId, "completed");
  const history = await store.summaries("a");
  const organization = { ...turn, turnId: "organization" };
  await Promise.all([
    store.apply(
      "a",
      { sections: { upsert: [review] }, upsert: [{ ...resource, section: "review" }] },
      undefined,
      organization,
    ),
    store.apply("a", { sections: { upsert: [preview] } }, undefined, organization),
  ]);
  const snapshot = await store.snapshot("a");
  assert.deepEqual(
    snapshot.sections,
    [review, preview].map((section) => ({ ...section, source: "agent" })),
  );
  assert.equal(snapshot.unreadCount, 1);
  assert.deepEqual(snapshot.pins[0].attention, notified.pin.attention);
  assert.deepEqual(await store.summaries("a"), history);
  assert.ok(notified.pin.attention);
  const ack = await store.acknowledge("a", [
    { key: resource.key, attentionToken: notified.pin.attention.token },
  ]);
  assert.deepEqual(ack.sections, snapshot.sections);
  assert.equal(ack.pins[0].section, "review");
  assert.equal(ack.unreadCount, 0);
  const removed = await store.remove("a", resource.key);
  assert.deepEqual(removed.sections, snapshot.sections);
  assert.deepEqual(groupPins(removed.pins, removed.sections), []);
});

test("versions 1–3 migrate lazily without losing history, identity, attention or order", async (t) => {
  const store = await fixture(t);
  await store.upsert("a", resource, undefined, turn);
  await store.upsert(
    "a",
    { ...resource, notify: { id: "event", reason: "Test" } },
    undefined,
    turn,
  );
  await store.finalize("a", turn.agentId, turn.turnId, "completed");
  const file = store.filePath("a"),
    current = JSON.parse(await readFile(file, "utf8"));
  for (const version of [1, 2, 3]) {
    const legacy = structuredClone(current);
    legacy.version = version;
    delete legacy.sections;
    delete legacy.refresh;
    delete legacy.repo;
    for (const pin of legacy.pins) {
      delete pin.section;
      delete pin.kept;
      delete pin.source;
      if (version < 3) delete pin.instanceId;
      if (version === 1) {
        delete pin.attention;
        delete pin.readAttentionToken;
        delete pin.consumedNotificationIds;
      }
    }
    if (version < 3) delete legacy.summaries;
    const text = JSON.stringify(legacy);
    await writeFile(file, text);
    const snapshot = await store.snapshot("a");
    assert.deepEqual(snapshot.sections, []);
    assert.equal(snapshot.pins[0].section, null);
    assert.equal(await readFile(file, "utf8"), text);
    await store.apply("a", { sections: { upsert: [review] } });
    const migrated = JSON.parse(await readFile(file, "utf8"));
    assert.equal(migrated.version, 7);
    assert.deepEqual(migrated.pins, snapshot.pins);
    assert.deepEqual(migrated.summaries, legacy.summaries ?? []);
    if (version > 1) assert.deepEqual(migrated.pins[0].attention, current.pins[0].attention);
  }
});

test("corrupt v4 references and duplicate section identities are preserved", async (t) => {
  const store = await fixture(t);
  await store.upsert("a", resource);
  const file = store.filePath("a"),
    valid = JSON.parse(await readFile(file, "utf8"));
  for (const document of [
    { ...valid, pins: [{ ...valid.pins[0], section: "missing" }] },
    { ...valid, sections: [review, review] },
  ]) {
    const text = JSON.stringify(document);
    await writeFile(file, text);
    await assert.rejects(store.snapshot("a"), /preserved/);
    await assert.rejects(store.apply("a", { sections: { upsert: [preview] } }), /preserved/);
    assert.equal(await readFile(file, "utf8"), text);
  }
});
