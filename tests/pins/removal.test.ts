import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeUserPin, undoUserRemoval } from "../../server/removals";
import { PinStore } from "../../server/store";
import { isUnread } from "../../shared/pins";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-removal-"));
  const repo = path.join(dir, "repo");
  await mkdir(repo);
  const store = new PinStore(path.join(dir, "data"), undefined, async () => repo);
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await store.apply("a", {
    sections: { upsert: [{ key: "work", title: "Work" }] },
    upsert: [
      { key: "preview", title: "Preview", url: "https://example.com", section: "work" },
      { key: "review", title: "Review", url: "https://example.com/review" },
    ],
  });
  await store.upsert("a", {
    key: "preview",
    title: "Preview",
    url: "https://example.com",
    notify: { id: "ready", reason: "Ready for review" },
  });
  const pin = (await store.list("a"))[0];
  await store.setKept("a", pin.key, pin.instanceId, true);
  return { store, repo, dir, pin: (await store.list("a"))[0] };
}

test("user removal overrides Keep, stays silent, and Undo survives a store restart with read state and ordering", async (t) => {
  const { store, dir, repo, pin } = await fixture(t);
  await assert.rejects(store.remove("a", pin.key), /kept/);
  const id = randomUUID();
  const result = await removeUserPin(store, "a", pin.key, pin.instanceId, id);
  assert.deepEqual(result.removal, { id, title: pin.title });
  assert.deepEqual(
    result.pins.map((p) => p.key),
    ["review"],
  );
  assert.deepEqual((await store.document("a")).summaries, []);
  const fresh = new PinStore(path.join(dir, "data"), undefined, async () => repo);
  t.after(() => fresh.close());
  const restored = await undoUserRemoval(fresh, "a", id);
  assert.deepEqual(
    restored.pins.map((p) => p.key),
    ["preview", "review"],
  );
  assert.notEqual(restored.pins[0].instanceId, pin.instanceId);
  assert.deepEqual(restored.pins[0], { ...pin, instanceId: restored.pins[0].instanceId });
  assert.equal(isUnread(restored.pins[0]), true);
  assert.deepEqual((await fresh.document("a")).summaries, []);
});

test("remove and undo retries are idempotent, workspace scoped and reject stale menu identities", async (t) => {
  const { store, pin } = await fixture(t);
  const id = randomUUID();
  const results = await Promise.all([
    removeUserPin(store, "a", pin.key, pin.instanceId, id),
    removeUserPin(store, "a", pin.key, pin.instanceId, id),
  ]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(undoUserRemoval(store, "b", id), /no longer available/);
  await assert.rejects(removeUserPin(store, "a", "review", pin.instanceId, id), /another pin/);
  const first = await undoUserRemoval(store, "a", id);
  assert.deepEqual(await undoUserRemoval(store, "a", id), first);
  const retry = await removeUserPin(store, "a", pin.key, pin.instanceId, id);
  assert.equal(retry.removal, null);
  assert.equal(retry.pins.length, 2);
  await assert.rejects(
    removeUserPin(store, "a", pin.key, pin.instanceId, randomUUID()),
    /replaced/,
  );
  await assert.rejects(store.setKept("a", pin.key, pin.instanceId, false), /replaced/);
  const restored = first.pins[0];
  await removeUserPin(store, "a", restored.key, restored.instanceId, randomUUID());
  await undoUserRemoval(store, "a", id);
  assert.equal(
    (await store.list("a")).length,
    1,
    "replaying an old Undo never resurrects a later deletion",
  );
});

test("Undo cannot overwrite or resurrect an old resource after its key is reused", async (t) => {
  const { store, pin } = await fixture(t);
  const id = randomUUID();
  await removeUserPin(store, "a", pin.key, pin.instanceId, id);
  await store.upsert("a", { key: pin.key, title: "New resource", url: "https://new.example.com" });
  await assert.rejects(undoUserRemoval(store, "a", id), /reused/);
  await store.remove("a", pin.key);
  await assert.rejects(undoUserRemoval(store, "a", id), /reused/);
  assert.equal((await store.list("a")).length, 1);
});

test("repository ownership and invalid config block removal and Undo; removed sections stay removed", async (t) => {
  const { store, repo, pin } = await fixture(t);
  const id = randomUUID();
  await removeUserPin(store, "a", pin.key, pin.instanceId, id);
  await store.apply("a", { sections: { remove: ["work"] } });
  const restored = (await undoUserRemoval(store, "a", id)).pins[0];
  assert.equal(restored.section, null);
  await mkdir(path.join(repo, ".paseo"));
  const config = path.join(repo, ".paseo", "pins.json");
  await writeFile(
    config,
    JSON.stringify({ version: 1, pins: [{ key: pin.key, title: "Repo preview", url: pin.url }] }),
  );
  const configured = (await store.list("a")).find((p) => p.key === pin.key);
  assert.ok(configured);
  assert.equal(configured.source, "repo");
  await assert.rejects(
    removeUserPin(store, "a", pin.key, configured.instanceId, randomUUID()),
    /Repository pins/,
  );
  await writeFile(config, "invalid");
  const review = (await store.list("a")).find((p) => p.key === "review");
  assert.ok(review);
  await assert.rejects(
    removeUserPin(store, "a", review.key, review.instanceId, randomUUID()),
    /configuration/,
  );
});

test("v7 migration adds empty receipts lazily and unreadable documents reject removal", async (t) => {
  const { store, pin } = await fixture(t);
  const { removals: _, ...old } = await store.document("a");
  await writeFile(store.filePath("a"), JSON.stringify({ ...old, version: 7 }));
  assert.deepEqual((await store.document("a")).removals, []);
  const before = await readFile(store.filePath("a"), "utf8");
  assert.equal(JSON.parse(before).version, 7);
  // An unreadable document must not be treated as an empty workspace.
  const file = store.filePath("a");
  await rm(file);
  await mkdir(file);
  await assert.rejects(
    removeUserPin(store, "a", pin.key, pin.instanceId, randomUUID()),
    /read workspace pins/,
  );
  await rm(file, { recursive: true });
  await writeFile(file, before);
  assert.deepEqual(
    (await store.document("a")).pins.find((p) => p.key === pin.key),
    pin,
  );
  const result = await removeUserPin(store, "a", pin.key, pin.instanceId, randomUUID());
  assert.ok(result.removal);
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 8);
});
