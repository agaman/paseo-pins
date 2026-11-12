import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { type Paseo, RefreshContext } from "../server/refresh-context";
import { RefreshCoordinator } from "../server/refresh-coordinator";
import { filesReadInput, refreshFiles } from "../server/refresh-files";
import {
  applyRefresh,
  pinRevision,
  reportRefresh,
  sectionRevision,
} from "../server/refresh-mutations";
import { PinStore } from "../server/store";
import { isUnread, pinDocumentSchema } from "../shared/pins";
import {
  refreshApplySchema,
  refreshReportSchema,
  refreshTitle,
  refreshView,
} from "../shared/refresh";
import { refreshRunSchema } from "../shared/refresh-state";

const pin = { key: "preview", title: "Preview", url: "https://example.com/preview" };
const worker = randomUUID();
const turn = { agentId: worker, turnId: "turn", startedAt: new Date().toISOString() };
async function fixture(t: { after(fn: () => Promise<void>): void }, populated = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-refresh-"));
  const store = new PinStore(dir);
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  if (populated) await store.upsert("a", pin);
  await store.transaction("a", (doc) => {
    doc.refresh = refreshRunSchema.parse({
      id: randomUUID(),
      requestId: randomUUID(),
      agentId: worker,
      profile: { id: "profile", name: "Profile", provider: "codex" },
      state: "running",
      outcome: null,
      reason: null,
      startedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 300000).toISOString(),
      endedAt: null,
      cleanupPending: false,
      launched: false,
      promptSent: false,
      initialCount: doc.pins.length,
      scope: Object.fromEntries(doc.pins.map((p) => [p.key, p.instanceId])),
      sectionKeys: [],
      created: [],
      removedKeys: [],
      changes: [],
      revision: 0,
      receipts: {},
      assessments: {},
      conversations: [{ id: "history", title: "Work", cursors: [] }],
      sources: [{ id: "source", title: "Work", agentId: "history" }],
      contextCharacters: 0,
      contextIssues: [],
      contextReady: true,
      discoveryComplete: false,
      reviewedSources: [],
      repositoryGaps: [],
    });
  });
  return store;
}
const apply = (store: PinStore, input: unknown) =>
  applyRefresh(store, "a", worker, refreshApplySchema.parse(input), turn);
const revision = async (store: PinStore) => pinRevision((await store.list("a"))[0]);

test("file inspection derives the workspace root and requires its active worker", async (t) => {
  const store = await fixture(t);
  const root = await mkdtemp(path.join(tmpdir(), "pins-scoped-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "work.txt"), "workspace evidence");
  const resolved: string[] = [];
  const context = {
    agent: { id: worker, workspaceId: "a" },
    signal: new AbortController().signal,
    paseo: {
      workspaces: {
        ref: (id: string) => {
          resolved.push(id);
          return { refresh: async () => ({ id, workspaceDirectory: root }) };
        },
      },
    },
  } as unknown as AgentToolContext;
  const files = await refreshFiles(store, context);
  assert.equal(
    (await files.read(filesReadInput.parse({ path: "work.txt" }))).text,
    "workspace evidence",
  );
  assert.deepEqual(resolved, ["a"]);
  await assert.rejects(
    refreshFiles(store, {
      ...context,
      agent: { ...context.agent, id: "unrelated-agent" },
    }),
    /no longer active/,
  );
  await assert.rejects(
    refreshFiles(store, {
      ...context,
      agent: { ...context.agent, workspaceId: "other" },
    }),
    /no longer active/,
  );
  await store.transaction("a", (doc) => {
    if (doc.refresh) doc.refresh.outcome = "canceled";
  });
  await assert.rejects(refreshFiles(store, context), /no longer active/);
  assert.deepEqual(resolved, ["a"]);
});

test("v4 migration preserves pins/history and adds no refresh run", async (t) => {
  const store = await fixture(t);
  const doc = await store.document("a");
  const { refresh: _refresh, ...old } = doc;
  const oldPins = old.pins.map(({ kept: _kept, ...pin }) => pin);
  await writeFile(store.filePath("a"), JSON.stringify({ ...old, pins: oldPins, version: 4 }));
  const loaded = await store.document("a");
  assert.equal(loaded.version, 6);
  assert.equal(loaded.refresh, null);
  assert.deepEqual(loaded.pins, doc.pins);
  assert.throws(() => pinDocumentSchema.parse({ ...old, version: 6 }));
});

test("discovery is evidence-backed, read, atomic, idempotent, and counted once", async (t) => {
  const store = await fixture(t, false);
  const batch = {
    operationId: "create",
    upsert: [
      {
        ...pin,
        expectedRevision: null,
        reason: "Current preview from ongoing work.",
        sources: ["source"],
      },
    ],
  };
  await assert.rejects(
    apply(store, { ...batch, upsert: [{ ...batch.upsert[0], sources: [] }] }),
    /require/,
  );
  const first = await apply(store, batch);
  assert.deepEqual(await apply(store, batch), first);
  assert.equal((await store.list("a")).length, 1);
  assert.equal(isUnread((await store.list("a"))[0]), false);
  await apply(store, {
    operationId: "edit",
    upsert: [
      {
        ...pin,
        title: "Final preview",
        expectedRevision: await revision(store),
        reason: "Clarify title.",
      },
    ],
  });
  assert.deepEqual(
    (await store.document("a")).refresh?.changes.map((c) => c.kind),
    ["added"],
  );
  await assert.rejects(
    apply(store, { ...batch, upsert: [{ ...batch.upsert[0], title: "Changed retry" }] }),
    /different input/,
  );
  const before = await readFile(store.filePath("a"), "utf8");
  await assert.rejects(
    apply(store, {
      operationId: "atomic",
      upsert: [
        {
          ...pin,
          key: "new",
          url: "https://new.example",
          expectedRevision: null,
          reason: "Useful.",
          sources: ["source"],
        },
      ],
      remove: [{ key: pin.key, expectedRevision: "0".repeat(64), reason: "Stale." }],
    }),
  );
  assert.equal(await readFile(store.filePath("a"), "utf8"), before);
  await apply(store, {
    operationId: "remove",
    remove: [{ key: pin.key, expectedRevision: await revision(store), reason: "Superseded." }],
  });
  assert.deepEqual((await store.document("a")).refresh?.changes, []);
  await assert.rejects(apply(store, { ...batch, operationId: "recreate" }), /removed/);
});

test("revision conflicts protect updates and lifetimes but permit acknowledgments", async (t) => {
  const store = await fixture(t);
  await store.upsert("a", { ...pin, notify: { id: "ready", reason: "Review is ready." } });
  const current = (await store.list("a"))[0];
  const expectedRevision = pinRevision(current);
  assert.ok(current.attention);
  await store.acknowledge("a", [{ key: pin.key, attentionToken: current.attention.token }]);
  await apply(store, {
    operationId: "ack-safe",
    upsert: [{ ...pin, title: "Preview ready", expectedRevision, reason: "Clarify title." }],
  });
  assert.equal(isUnread((await store.list("a"))[0]), false);
  const stale = await revision(store);
  await store.upsert("a", { ...pin, notify: { id: "newer", reason: "Another release." } });
  await assert.rejects(
    apply(store, {
      operationId: "conflict",
      remove: [{ key: pin.key, expectedRevision: stale, reason: "Obsolete." }],
    }),
    /changed/,
  );
  await store.remove("a", pin.key);
  await store.upsert("a", pin);
  await assert.rejects(
    apply(store, {
      operationId: "lifetime",
      remove: [{ key: pin.key, expectedRevision: await revision(store), reason: "Obsolete." }],
    }),
    /outside/,
  );
});

test("new discoveries cannot overwrite concurrent keys or equivalent destinations", async (t) => {
  const store = await fixture(t, false);
  await store.upsert("a", { ...pin, url: "https://example.com" });
  await assert.rejects(
    apply(store, {
      operationId: "duplicate",
      upsert: [
        {
          ...pin,
          key: "duplicate",
          url: "https://EXAMPLE.com:443/",
          expectedRevision: null,
          sources: ["source"],
          reason: "Found.",
        },
      ],
    }),
    /already exists/,
  );
  assert.equal((await store.list("a")).length, 1);
});

test("section cleanup requires membership and pin revisions, and no-op sections do not inflate results", async (t) => {
  const store = await fixture(t);
  await apply(store, {
    operationId: "group",
    sections: {
      upsert: [
        { key: "work", title: "Work", expectedRevision: null, reason: "Group active work." },
      ],
    },
    upsert: [
      {
        ...pin,
        section: "work",
        expectedRevision: await revision(store),
        reason: "Group active work.",
      },
    ],
  });
  const doc = await store.document("a");
  const section = sectionRevision(doc, "work");
  await apply(store, {
    operationId: "noop",
    sections: {
      upsert: [{ key: "work", title: "Work", expectedRevision: section, reason: "Keep heading." }],
    },
  });
  assert.equal((await store.document("a")).refresh?.changes.length, 2);
  await assert.rejects(
    apply(store, {
      operationId: "missing-members",
      sections: { remove: [{ key: "work", expectedRevision: section, reason: "Simplify." }] },
    }),
    /changed/,
  );
  await store.upsert("a", { ...pin, key: "other", section: "work" });
  const newer = await store.document("a");
  await assert.rejects(
    apply(store, {
      operationId: "foreign",
      memberRevisions: Object.fromEntries(newer.pins.map((p) => [p.key, pinRevision(p)])),
      sections: {
        remove: [
          { key: "work", expectedRevision: sectionRevision(newer, "work"), reason: "Simplify." },
        ],
      },
    }),
    /outside/,
  );
});

test("cancel and deadline reject late writes and late completion cannot overwrite cancellation", async (t) => {
  const store = await fixture(t);
  const coordinator = new RefreshCoordinator(store, async () => null);
  const run = (await store.document("a")).refresh;
  assert.ok(run);
  await coordinator.cancel("a", run.id);
  await coordinator.finish("a", worker);
  assert.equal((await store.document("a")).refresh?.outcome, "canceled");
  await assert.rejects(
    apply(store, {
      operationId: "late",
      remove: [{ key: pin.key, expectedRevision: await revision(store), reason: "Old." }],
    }),
    /no longer active/,
  );
  await store.transaction("a", (d) => {
    assert.ok(d.refresh);
    d.refresh.outcome = null;
    d.refresh.state = "running";
    d.refresh.deadline = new Date(0).toISOString();
  });
  await assert.rejects(
    apply(store, {
      operationId: "expired",
      remove: [{ key: pin.key, expectedRevision: await revision(store), reason: "Old." }],
    }),
    /no longer active/,
  );
  assert.equal((await store.list("a")).length, 1);
  await coordinator.close();
});

test("complete requires fresh pin assessments and discovery coverage", async (t) => {
  const store = await fixture(t);
  await reportRefresh(
    store,
    "a",
    worker,
    refreshReportSchema.parse({
      operationId: "report",
      reviewed: [{ key: pin.key, revision: await revision(store) }],
      unverified: [],
      discovery: { complete: true, reviewedSources: ["source"], repositoryGaps: [] },
    }),
  );
  const coordinator = new RefreshCoordinator(store, async () => null);
  await store.upsert("a", { ...pin, title: "Changed by another agent" });
  await coordinator.finish("a", worker);
  const view = refreshView((await store.document("a")).refresh);
  assert.ok(view);
  assert.equal(view.outcome, "partial");
  assert.equal(view.unverified, 1);
  assert.equal(refreshTitle(view), "No pins changed");
  await coordinator.close();
});

test("context access verifies workspace membership, excludes reasoning, bounds output, and never reads arbitrary agents", async (t) => {
  const store = await fixture(t);
  const context = new RefreshContext(store);
  let reads = 0;
  let workspaceId = "a";
  const paseo = {
    agents: {
      ref: () => ({
        refresh: async () => ({ agent: { workspaceId, labels: {} } }),
        timeline: {
          refetch: async () => {
            reads++;
            return {
              entries: [
                { item: { type: "reasoning", text: "secret reasoning" }, seqStart: 1, seqEnd: 1 },
                {
                  item: { type: "assistant_message", text: "Current preview https://example.com" },
                  seqStart: 2,
                  seqEnd: 2,
                },
                { item: { type: "user_message", text: "x".repeat(9000) }, seqStart: 3, seqEnd: 3 },
              ],
              hasOlder: true,
              startCursor: { epoch: "epoch", seq: 1 },
              error: null,
            };
          },
        },
      }),
    },
  } as unknown as Paseo;
  await assert.rejects(context.read("a", worker, paseo, { agentId: "other" }), /outside/);
  assert.equal(reads, 0);
  const result = await context.read("a", worker, paseo, { agentId: "history" });
  assert.ok("entries" in result);
  assert.equal(result.entries.length, 2);
  assert.equal(result.omittedMessages, true);
  assert.ok(result.cursor);
  await assert.rejects(
    context.read("a", worker, paseo, { agentId: "history", cursor: "fake" }),
    /outside/,
  );
  workspaceId = "another-workspace";
  await assert.rejects(
    context.read("a", worker, paseo, { agentId: "history", cursor: result.cursor }),
    /no longer available/,
  );
  assert.equal(reads, 1);
  assert.equal((await store.document("a")).refresh?.contextIssues.length, 1);
});

test("refresh respects Keep after rereading and preserves the entire rejected batch", async (t) => {
  const store = await fixture(t);
  const current = (await store.list("a"))[0];
  const staleRevision = pinRevision(current);
  await store.setKept("a", current.key, current.instanceId, true);
  const batch = (expectedRevision: string) => ({
    operationId: "remove-kept",
    remove: [{ key: current.key, expectedRevision, reason: "Obsolete" }],
  });
  await assert.rejects(apply(store, batch(staleRevision)), /changed/);
  const before = await store.document("a");
  await assert.rejects(apply(store, batch(await revision(store))), /kept/);
  assert.deepEqual(await store.document("a"), before);
});
