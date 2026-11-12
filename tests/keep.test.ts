import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PinStore } from "../server/store";
import { applyPinsSchema, isUnread, pinDocumentSchema, upsertPinSchema } from "../shared/pins";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-keep-"));
  const store = new PinStore(dir);
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
  return { store, dir, pin: (await store.list("a"))[0] };
}

test("Keep is durable, silent, workspace scoped and preserves resource updates and acknowledgment", async (t) => {
  const { store, dir, pin } = await fixture(t);
  const before = await store.document("a");
  await store.setKept("a", pin.key, pin.instanceId, true);
  const kept = (await store.list("a"))[0];
  assert.deepEqual(kept, { ...pin, kept: true });
  assert.equal(isUnread(kept), false);
  assert.deepEqual((await store.document("a")).summaries, before.summaries);
  const fresh = new PinStore(dir);
  t.after(() => fresh.close());
  assert.equal((await fresh.list("a"))[0].kept, true);
  assert.deepEqual(await store.list("b"), []);
  await store.upsert("a", {
    key: pin.key,
    title: "New preview",
    url: "https://example.com/new",
    notify: { id: "ready", reason: "Ready to review" },
  });
  const updated = (await store.list("a"))[0];
  assert.equal(updated.kept, true);
  assert.equal(updated.section, "work");
  assert.ok(updated.attention);
  await store.acknowledge("a", [{ key: pin.key, attentionToken: updated.attention.token }]);
  assert.equal((await store.list("a"))[0].kept, true);
  await store.apply("a", { sections: { remove: ["work"] } });
  assert.equal((await store.list("a"))[0].kept, true);
  assert.equal((await store.list("a"))[0].section, null);
  await store.setKept("a", pin.key, pin.instanceId, false);
  assert.equal((await store.remove("a", pin.key)).status, "removed");
});

test("protected removal rejects single, mixed and transaction batches without partial writes", async (t) => {
  const { store, pin } = await fixture(t);
  await store.setKept("a", pin.key, pin.instanceId, true);
  const before = await readFile(store.filePath("a"), "utf8");
  const batch = {
    remove: ["review", pin.key],
    sections: { remove: ["work"] },
    upsert: [{ key: "new", title: "New", url: "https://new.example" }],
  };
  await assert.rejects(store.remove("a", pin.key), /kept/);
  await assert.rejects(store.apply("a", batch), /kept/);
  await assert.rejects(
    store.transaction("a", (_, apply) => apply(batch)),
    /kept/,
  );
  assert.equal(await readFile(store.filePath("a"), "utf8"), before);
  assert.throws(() =>
    upsertPinSchema.parse({ key: pin.key, title: pin.title, url: pin.url, kept: false }),
  );
  assert.throws(() =>
    applyPinsSchema.parse({
      upsert: [{ key: pin.key, title: pin.title, url: pin.url, kept: false }],
    }),
  );
});

test("queued Keep wins against later removal and stale menu identities cannot affect replacements", async (t) => {
  const { store, pin } = await fixture(t);
  const keep = store.setKept("a", pin.key, pin.instanceId, true);
  const remove = store.remove("a", pin.key);
  await keep;
  await assert.rejects(remove, /kept/);
  await store.setKept("a", pin.key, pin.instanceId, false);
  await store.remove("a", pin.key);
  await store.upsert("a", { key: pin.key, title: "Replacement", url: pin.url });
  await assert.rejects(store.setKept("a", pin.key, pin.instanceId, true), /replaced/);
  assert.equal((await store.list("a")).find((p) => p.key === pin.key)?.kept, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    store.setKept("a", "review", (await store.list("a"))[0].instanceId, true, controller.signal),
    /canceled/,
  );
});

test("v5 pins migrate lazily with Keep off; malformed v6 protection is rejected", async (t) => {
  const { store, pin } = await fixture(t);
  const old = {
    ...(await store.document("a")),
    version: 5,
    pins: (await store.list("a")).map(({ kept: _kept, ...p }) => p),
  };
  const raw = JSON.stringify(old);
  await writeFile(store.filePath("a"), raw);
  const migrated = await store.document("a");
  assert.equal(migrated.version, 6);
  assert.ok(migrated.pins.every((p) => p.kept === false));
  assert.equal(await readFile(store.filePath("a"), "utf8"), raw);
  await store.setKept("a", pin.key, pin.instanceId, true);
  assert.equal(JSON.parse(await readFile(store.filePath("a"), "utf8")).version, 6);
  assert.throws(() => pinDocumentSchema.parse({ ...migrated, pins: [{ ...pin, kept: "yes" }] }));
  assert.throws(() =>
    pinDocumentSchema.parse({ ...migrated, pins: [{ ...pin, kept: undefined }] }),
  );
});
