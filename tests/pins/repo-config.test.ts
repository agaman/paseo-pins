import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readRepoConfig } from "../../server/repo-config";
import { PinStore } from "../../server/store";
import { pinDocumentSchema } from "../../shared/pin-document";
import { applyPinsSchema, isUnread } from "../../shared/pins";

const preview = { key: "preview", title: "Preview", url: "https://preview.example.com" };
const section = { key: "work", title: "Work" };
const turn = { agentId: "a", turnId: "turn", startedAt: "2026-11-12T00:00:00.000Z" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-config-"));
  const root = path.join(dir, "checkout");
  await mkdir(path.join(root, ".paseo"), { recursive: true });
  let clock = Date.parse(turn.startedAt);
  const store = new PinStore(
    path.join(dir, "data"),
    () => new Date(clock).toISOString(),
    async (id) => {
      if (id !== "a") throw new Error("Unknown workspace");
      return root;
    },
  );
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(root, ".paseo/pins.json");
  return {
    store,
    root,
    file,
    tick: () => {
      clock += 1000;
    },
    config: (value: unknown) => writeFile(file, JSON.stringify(value)),
  };
}

test("config populates silently, takes ownership including Keep, and reconciles atomically in stable order", async (t) => {
  const { store, config, tick } = await fixture(t);
  await store.apply("a", {
    sections: { upsert: [section] },
    upsert: [
      preview,
      { key: "other", title: "Other", url: "https://other.example.com", section: "work" },
    ],
  });
  const pin = (await store.list("a"))[0];
  await store.setKept("a", pin.key, pin.instanceId, true);
  tick();
  await config({
    version: 1,
    sections: [{ ...section, title: "Configured work" }],
    pins: [
      { ...preview, title: "Workspace preview", section: "work" },
      { key: "docs", title: "Docs", url: "https://docs.example.com" },
    ],
  });
  const result = await store.snapshot("a");
  assert.equal(result.config.loaded, true);
  assert.deepEqual(
    result.pins.map((p) => p.key),
    ["preview", "other", "docs"],
  );
  assert.deepEqual(
    result.pins.map((p) => p.source),
    ["repo", "agent", "repo"],
  );
  assert.equal(result.pins[0].instanceId, pin.instanceId);
  assert.equal(result.pins[0].createdAt, pin.createdAt);
  assert.equal(result.pins[0].kept, true);
  assert.equal(result.unreadCount, 0);
  assert.equal(result.sections[0].title, "Configured work");
  assert.equal(result.sections[0].source, "repo");
  assert.deepEqual((await store.document("a")).summaries, []);
  const bytes = await readFile(store.filePath("a"), "utf8");
  await store.list("a");
  assert.equal(await readFile(store.filePath("a"), "utf8"), bytes);
  await assert.rejects(store.apply("a", { remove: ["other", "preview"] }), /owned/);
  await assert.rejects(store.upsert("a", preview), /owned/);
  await assert.rejects(store.setKept("a", pin.key, pin.instanceId, false), /no Keep/);
  await assert.rejects(store.apply("a", { sections: { upsert: [section] } }), /owned/);
  await assert.rejects(store.apply("a", { sections: { remove: [section.key] } }), /owned/);
  assert.equal(await readFile(store.filePath("a"), "utf8"), bytes);
  await store.upsert("a", {
    key: "member",
    title: "Member",
    url: "https://member.example.com",
    section: "work",
  });
  await config({ version: 1, pins: [] });
  const removed = await store.snapshot("a");
  assert.deepEqual(
    removed.pins.map((p) => [p.key, p.section]),
    [
      ["other", null],
      ["member", null],
    ],
  );
  assert.deepEqual(removed.sections, []);
});

test("explicit notifications preserve config definitions, summarize, deduplicate, and reject stale destinations/lifetimes", async (t) => {
  const { store, config } = await fixture(t);
  await config({ version: 1, pins: [preview] });
  const pin = (await store.list("a"))[0];
  const notify = {
    key: pin.key,
    instanceId: pin.instanceId,
    expectedUrl: pin.url,
    id: "ready",
    reason: "The new navigation is deployed.",
  };
  const result = await store.apply("a", { notify: [notify] }, undefined, turn);
  assert.equal(result.notify[0].notified, true);
  assert.equal(isUnread(result.pins[0]), true);
  assert.equal(result.pins[0].source, "repo");
  assert.equal((await store.document("a")).summaries[0].entries[0].reason, notify.reason);
  const oldToken = result.pins[0].attention?.token;
  await config({ version: 1, pins: [{ ...preview, url: "https://new.example.com" }] });
  const edited = await store.snapshot("a");
  assert.equal(edited.pins[0].attention?.token, oldToken);
  const retry = await store.apply("a", { notify: [notify] }, undefined, turn);
  assert.equal(retry.notify[0].notified, false);
  await assert.rejects(
    store.apply("a", { notify: [{ ...notify, id: "another" }] }),
    /different destination/,
  );
  await config({ version: 1, pins: [] });
  await store.snapshot("a");
  await config({ version: 1, pins: [preview] });
  await assert.rejects(store.apply("a", { notify: [{ ...notify, id: "new" }] }), /replaced/);
  assert.equal((await store.document("a")).summaries[0].entries[0].url, pin.url);
  assert.equal((await store.snapshot("a")).unreadCount, 0);
  assert.throws(() => applyPinsSchema.parse({ upsert: [preview], notify: [notify] }));
});

test("invalid configs preserve last valid pins and acknowledgments while blocking resource writes", async (t) => {
  const { store, config, file } = await fixture(t);
  await config({ version: 1, pins: [preview] });
  const pin = (await store.list("a"))[0];
  await store.apply("a", {
    notify: [
      {
        key: pin.key,
        instanceId: pin.instanceId,
        expectedUrl: pin.url,
        id: "one",
        reason: "Ready",
      },
    ],
  });
  const token = (await store.list("a"))[0].attention?.token;
  assert.ok(token);
  await writeFile(file, '{"version":');
  const snapshot = await store.snapshot("a");
  assert.match(snapshot.config.error ?? "", /valid JSON/);
  assert.equal(snapshot.config.loaded, true);
  await assert.rejects(store.upsert("a", { ...preview, key: "unrelated" }), /paused/);
  const ack = await store.acknowledge("a", [{ key: pin.key, attentionToken: token }]);
  assert.equal(ack.unreadCount, 0);
  assert.equal(ack.config.error, snapshot.config.error);
  for (const bad of [
    { version: 2, pins: [] },
    { version: 1, pins: [preview, preview] },
    { version: 1, pins: [{ ...preview, section: "missing" }] },
    { version: 1, pins: [{ ...preview, source: "agent" }] },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Verify literal substitution syntax is rejected.
    { version: 1, pins: [{ ...preview, url: "https://${PREVIEW_URL}" }] },
  ]) {
    await config(bad);
    const result = await store.snapshot("a");
    assert.ok(result.config.error);
    assert.equal(result.pins[0].instanceId, pin.instanceId);
  }
  await config({ version: 1, pins: [preview] });
  assert.equal((await store.snapshot("a")).config.error, null);
});

test("file deletion is confirmed across checks and preserves unrelated pins; unavailable roots and symlinks are not deletion", async (t) => {
  const { store, config, file, root, tick } = await fixture(t);
  await store.upsert("a", { ...preview, key: "agent" });
  await config({ version: 1, pins: [preview] });
  await store.snapshot("a");
  await rm(file);
  const first = await store.snapshot("a");
  assert.equal(first.pins.length, 2);
  assert.ok(first.config.error);
  assert.equal((await store.snapshot("a")).pins.length, 2);
  tick();
  const second = await store.snapshot("a");
  assert.deepEqual(
    second.pins.map((p) => p.key),
    ["agent"],
  );
  assert.equal(second.config.loaded, false);
  await config({ version: 1, pins: [preview] });
  await store.snapshot("a");
  await rm(file);
  await symlink(path.join(root, "elsewhere.json"), file);
  const linked = await store.snapshot("a");
  assert.equal(linked.pins.length, 2);
  assert.ok(linked.config.error);
  assert.equal((await readRepoConfig(path.join(root, "missing-root"))).kind, "error");
  assert.equal((await store.snapshot("unknown")).config.loaded, false);
  await assert.rejects(store.upsert("unknown", preview), /unavailable/);
});

test("v6 migration preserves runtime state, and corrupt ownership metadata is rejected", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("a", preview);
  const current = await store.document("a");
  const { repo: _repo, removals: _removals, ...old } = current;
  const legacy = {
    ...old,
    version: 6,
    pins: old.pins.map(({ source: _source, ...p }) => p),
    sections: old.sections.map(({ source: _source, ...s }) => s),
  };
  const bytes = JSON.stringify(legacy);
  await writeFile(store.filePath("a"), bytes);
  assert.deepEqual(await store.document("a"), current);
  assert.equal(await readFile(store.filePath("a"), "utf8"), bytes);
  assert.throws(() =>
    pinDocumentSchema.parse({ ...current, pins: [{ ...current.pins[0], source: "repo" }] }),
  );
  assert.throws(() =>
    pinDocumentSchema.parse({ ...current, pins: [{ ...current.pins[0], source: undefined }] }),
  );
});

test("config-aware queue preserves invocation order and shutdown drains delayed lookups", async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ version: 1, pins: [] }));
  let resolveFirst: ((root: string) => void) | undefined;
  let calls = 0;
  const store = new PinStore(path.join(root, "data"), undefined, () =>
    ++calls === 1
      ? new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve(root),
  );
  const first = store.upsert("a", { ...preview, title: "First" });
  const second = store.upsert("a", { ...preview, title: "Second" });
  const closing = store.close();
  await Promise.resolve();
  assert.ok(resolveFirst);
  resolveFirst(root);
  await Promise.all([first, second, closing]);
  assert.equal((await store.list("a"))[0].title, "Second");
});

test("canceled access and unreadable storage do not replace persisted pins", async (t) => {
  const { store, config } = await fixture(t);
  await store.upsert("a", preview);
  const before = await readFile(store.filePath("a"), "utf8");
  await config({ version: 1, pins: [{ ...preview, title: "Configured" }] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.apply("a", { remove: [preview.key] }, controller.signal), /canceled/);
  assert.equal(await readFile(store.filePath("a"), "utf8"), before);
  await rm(store.filePath("a"));
  await mkdir(store.filePath("a"));
  await assert.rejects(store.snapshot("a"), /read workspace pins/);
});
