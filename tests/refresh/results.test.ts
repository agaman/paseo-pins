import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RefreshResults } from "../../server/refresh/results";
import { PinStore } from "../../server/store";
import { type RefreshRun, refreshRunSchema } from "../../shared/refresh-state";

const startedAt = "2026-11-14T00:00:00.000Z";
function run(overrides: Partial<RefreshRun> = {}) {
  return refreshRunSchema.parse({
    id: randomUUID(),
    requestId: randomUUID(),
    agentId: randomUUID(),
    profile: { id: "profile", name: "Profile", provider: "test" },
    state: "finished",
    outcome: "completed",
    reason: null,
    startedAt,
    deadline: "2026-11-14T00:05:00.000Z",
    endedAt: startedAt,
    cleanupPending: false,
    launched: false,
    promptSent: false,
    initialCount: 0,
    scope: {},
    sectionKeys: [],
    created: [],
    removedKeys: [],
    changes: [],
    revision: 0,
    receipts: {},
    assessments: {},
    conversations: [],
    sources: [],
    contextCharacters: 0,
    contextIssues: [],
    contextReady: true,
    discoveryComplete: true,
    reviewedSources: [],
    repositoryGaps: [],
    ...overrides,
  });
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-refresh-results-"));
  const store = new PinStore(dir);
  let clock = Date.parse(startedAt);
  const results = new RefreshResults(store, () => clock);
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    store,
    dir,
    results,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    set: (value: RefreshRun, workspace = "a") =>
      store.transaction(workspace, (doc) => {
        doc.refresh = value;
      }),
  };
}

test("viewed and dismissed refresh results persist across stores and clients without changing pins", async (t) => {
  const { store, results, set, dir, now, advance } = await fixture(t);
  await store.upsert("a", { key: "docs", title: "Docs", url: "https://example.com" });
  const pins = await store.list("a");
  const first = run();
  await set(first);
  assert.equal((await results.read("a")).presentation?.state, "visible");
  await results.acknowledge("a", first.id, "viewed");
  const restartedStore = new PinStore(dir);
  t.after(() => restartedStore.close());
  const otherDevice = new RefreshResults(restartedStore, now);
  assert.equal((await otherDevice.read("a")).presentation?.state, "viewed");
  advance(1000);
  await otherDevice.acknowledge("a", first.id, "dismissed");
  const saved = (await store.document("a")).refresh;
  assert.ok(saved?.resultViewedAt);
  assert.ok(saved.resultDismissedAt);
  advance(1000);
  await results.acknowledge("a", first.id, "viewed");
  await results.acknowledge("a", first.id, "dismissed");
  assert.deepEqual((await store.document("a")).refresh, saved);
  assert.equal((await results.read("a")).presentation?.state, "dismissed");
  assert.deepEqual(await store.list("a"), pins);
});

test("daemon expires old successful results but preserves active cleanup and errors until dismissal", async (t) => {
  const { results, set, advance } = await fixture(t);
  const current = run();
  await set(current);
  advance(15 * 60 * 1000 - 1);
  assert.equal((await results.read("a")).presentation?.state, "visible");
  advance(1);
  assert.equal((await results.read("a")).presentation?.state, "expired");
  await set(run({ outcome: "partial" }));
  assert.equal((await results.read("a")).presentation?.state, "expired");
  for (const outcome of ["failed", "timed_out", "permission_limited", "canceled"] as const) {
    const failed = run({ outcome });
    await set(failed);
    await results.acknowledge("a", failed.id, "viewed");
    assert.deepEqual((await results.read("a")).presentation, {
      state: "visible",
      autoDismiss: false,
    });
    await results.acknowledge("a", failed.id, "dismissed");
    assert.equal((await results.read("a")).presentation?.state, "dismissed");
  }
  for (const active of [
    run({ outcome: null, state: "running", endedAt: null }),
    run({ cleanupPending: true }),
  ]) {
    await set(active);
    await results.acknowledge("a", active.id, "dismissed");
    await results.acknowledge("a", active.id, "viewed");
    assert.deepEqual((await results.read("a")).presentation, {
      state: "active",
      autoDismiss: false,
    });
  }
});

test("stale acknowledgments cannot hide newer runs or affect other workspaces", async (t) => {
  const { store, results, set } = await fixture(t);
  const old = run(),
    next = run();
  await set(old);
  await set(old, "b");
  await results.acknowledge("a", old.id, "viewed");
  await set(next);
  await results.acknowledge("a", old.id, "dismissed");
  assert.equal((await results.read("a")).run?.id, next.id);
  assert.equal((await results.read("a")).presentation?.state, "visible");
  assert.equal((await results.read("b")).presentation?.state, "visible");
  assert.equal((await store.document("a")).refresh?.resultDismissedAt, null);
  assert.deepEqual(await results.read("absent"), { run: null, presentation: null });
});

test("legacy refresh runs load lazily and expire without resurrecting old results", async (t) => {
  const { store, results, set, advance } = await fixture(t);
  await set(run());
  const document = await store.document("a");
  const legacy = JSON.parse(JSON.stringify(document));
  delete legacy.refresh.resultViewedAt;
  delete legacy.refresh.resultDismissedAt;
  const bytes = JSON.stringify(legacy);
  await writeFile(store.filePath("a"), bytes);
  advance(24 * 60 * 60 * 1000);
  assert.equal((await results.read("a")).presentation?.state, "expired");
  assert.equal(await readFile(store.filePath("a"), "utf8"), bytes);
  assert.equal((await store.document("a")).refresh?.resultViewedAt, null);
});
