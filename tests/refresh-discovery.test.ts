import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type Paseo, RefreshContext } from "../server/refresh-context";
import { RefreshCoordinator } from "../server/refresh-coordinator";
import { applyRefresh, pinRevision, reportRefresh } from "../server/refresh-mutations";
import { PinStore } from "../server/store";
import { pinDocumentSchema } from "../shared/pins";
import { refreshApplySchema, refreshReportSchema } from "../shared/refresh";
import { refreshRunSchema } from "../shared/refresh-state";

function present<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  mode: "discovery" | "maintenance" = "discovery",
  threads = 1,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-discovery-"));
  const store = new PinStore(dir);
  const worker = randomUUID();
  t.after(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  if (mode === "maintenance")
    await store.upsert("a", { key: "preview", title: "Preview", url: "https://preview.example" });
  await store.transaction("a", (doc) => {
    doc.refresh = refreshRunSchema.parse({
      id: randomUUID(),
      requestId: randomUUID(),
      agentId: worker,
      profile: { id: "test", name: "Test", provider: "test/model" },
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
      discoveryVersion: 2,
      mode,
      scope: Object.fromEntries(doc.pins.map((p) => [p.key, p.instanceId])),
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
      contextReady: false,
      discoveryComplete: false,
      reviewedSources: [],
      repositoryGaps: [],
    });
  });
  let workspaceId = "a";
  const calls: { direction: string; cursor?: { epoch: string; seq: number } }[] = [];
  const rows = [
    {
      item: {
        type: "user_message",
        text: "The accessibility redesign is ready for review. What still needs a decision?",
      },
      seqStart: 100,
      seqEnd: 100,
      timestamp: "2026-11-12T12:00:00Z",
    },
    {
      item: {
        type: "assistant_message",
        text: `${"Detailed implementation notes. ".repeat(400)}Current review https://example.com/review?version=2#changes`,
      },
      seqStart: 90,
      seqEnd: 90,
      timestamp: "2026-11-12T11:00:00Z",
    },
    {
      item: {
        type: "tool_call",
        name: "build",
        status: "completed",
        detail: {
          type: "plain_text",
          text: "Produced the accessibility audit; review the keyboard navigation findings.",
        },
      },
      seqStart: 80,
      seqEnd: 80,
      timestamp: "2026-11-12T10:00:00Z",
    },
    {
      item: { type: "assistant_message", text: "Older useful staging https://staging.example" },
      seqStart: 70,
      seqEnd: 70,
      timestamp: "2026-11-12T09:00:00Z",
    },
  ];
  const paseo = {
    agents: {
      list: async () => ({
        entries: Array.from({ length: threads }, (_, i) => ({
          agent: { id: `thread-${i}`, workspaceId: "a", title: `Work ${i}`, labels: {} },
        })),
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      ref: () => ({
        refresh: async () => ({ agent: { workspaceId, labels: {} } }),
        timeline: {
          refetch: async (options: {
            direction: string;
            cursor?: { epoch: string; seq: number };
          }) => {
            calls.push(options);
            const row =
              options.direction === "after"
                ? rows.find(
                    (r) =>
                      r.seqStart > (options.cursor?.seq ?? 0) &&
                      r.seqStart <= (options.cursor?.seq ?? 0) + 1,
                  )
                : options.direction === "before"
                  ? rows.find((r) => r.seqStart < (options.cursor?.seq ?? Infinity))
                  : rows[0];
            const seq = row?.seqStart ?? 0;
            return {
              entries: row ? [row] : [],
              hasOlder: seq > 70,
              startCursor: { epoch: "epoch", seq },
              endCursor: { epoch: "epoch", seq },
              error: null,
            };
          },
        },
      }),
    },
  } as unknown as Paseo;
  return {
    store,
    worker,
    paseo,
    calls,
    rows,
    context: new RefreshContext(store),
    move: () => {
      workspaceId = "elsewhere";
    },
  };
}

test("empty-list discovery scans broader history; maintenance starts with recent work only", async (t) => {
  for (const mode of ["maintenance", "discovery"] as const) {
    const f = await fixture(t, mode);
    const packet = await f.context.prepare("a", f.worker, f.paseo);
    assert.equal(packet.mode, mode);
    assert.equal(f.calls.length, mode === "discovery" ? 4 : 1);
    assert.equal(packet.resources.resources.length, mode === "discovery" ? 2 : 0);
    assert.ok(JSON.stringify(packet.pages).includes("accessibility redesign"));
    if (mode === "discovery")
      assert.ok(JSON.stringify(packet.pages).includes("Produced the accessibility audit"));
    assert.ok(present((await f.store.document("a")).refresh).contextCharacters < 40000);
  }
});

test("initial context reserves half the delivery budget even across ten discovery conversations", async (t) => {
  const f = await fixture(t, "discovery", 10);
  await f.context.prepare("a", f.worker, f.paseo);
  assert.ok(present((await f.store.document("a")).refresh).contextCharacters <= 40000);
  assert.equal(f.calls.length, 40);
});

test("long messages yield excerpts and indexed mentions with retrievable surrounding evidence", async (t) => {
  const f = await fixture(t);
  const packet = await f.context.prepare("a", f.worker, f.paseo);
  const mention = present(packet.resources.resources.find((r) => r.url.includes("review")))
    .mentions[0];
  assert.ok(mention.offset > 9000);
  const result = await f.context.read("a", f.worker, f.paseo, {
    action: "source",
    sourceId: mention.sourceId,
    offset: mention.offset - 100,
  });
  assert.ok("text" in result);
  assert.ok(result.text.includes("Current review https://example.com/review?version=2#changes"));
  assert.equal(result.nextOffset, null);
  await assert.rejects(
    f.context.read("a", f.worker, f.paseo, { action: "source", sourceId: "outside" }),
    /outside/,
  );
  f.move();
  await assert.rejects(
    f.context.read("a", f.worker, f.paseo, { action: "resources" }),
    /no longer available/,
  );
  await assert.rejects(
    f.context.read("a", f.worker, f.paseo, { action: "source", sourceId: mention.sourceId }),
    /no longer available/,
  );
});

test("resource index reconstructs after reload without persisting conversation excerpts", async (t) => {
  const f = await fixture(t);
  const packet = await f.context.prepare("a", f.worker, f.paseo);
  const result = await new RefreshContext(f.store).read("a", f.worker, f.paseo, {
    action: "resources",
  });
  assert.ok("resources" in result);
  assert.deepEqual(result.resources, packet.resources.resources);
  assert.ok(!JSON.stringify(await f.store.document("a")).includes("Detailed implementation notes"));
});

test("discovery v2 requires priority accounting and distinguishes missing evidence from no destination", async (t) => {
  const f = await fixture(t);
  await f.context.prepare("a", f.worker, f.paseo);
  const source = present(
    present((await f.store.document("a")).refresh).sources.find((s) => s.inspected),
  ).id;
  const base = {
    reviewed: [],
    unverified: [],
    discovery: { complete: true, reviewedSources: [source], repositoryGaps: [] },
  };
  const report = (input: unknown) =>
    reportRefresh(f.store, "a", f.worker, refreshReportSchema.parse(input));
  await assert.rejects(report({ ...base, operationId: "missing" }), /Account for active/);
  const priority = {
    id: "accessibility",
    work: "Accessibility redesign",
    reason: "Ready for review",
    sources: [source],
    outcome: "no_destination",
    pins: [],
    investigation: "",
  };
  await assert.rejects(
    report({
      ...base,
      operationId: "no-investigation",
      discovery: { ...base.discovery, priorities: [priority] },
    }),
    /Explain the investigation/,
  );
  await assert.rejects(
    report({
      ...base,
      operationId: "unresolved",
      discovery: { ...base.discovery, priorities: [{ ...priority, outcome: "unresolved" }] },
    }),
    /Unresolved priorities/,
  );
  await report({
    ...base,
    operationId: "gap",
    discovery: {
      ...base.discovery,
      complete: false,
      priorities: [
        {
          ...priority,
          outcome: "unresolved",
          investigation: "No review destination in supplied context; more investigation is needed.",
        },
      ],
    },
  });
  assert.equal(present((await f.store.document("a")).refresh).discoveryComplete, false);
  await report({
    ...base,
    operationId: "investigated",
    discovery: {
      ...base.discovery,
      priorities: [
        {
          ...priority,
          investigation:
            "Reviewed the task discussion: this outcome is a local-only artifact without an HTTP destination.",
        },
      ],
    },
  });
  const coordinator = new RefreshCoordinator(f.store, async () => null);
  await coordinator.finish("a", f.worker);
  assert.equal(present((await f.store.document("a")).refresh).outcome, "completed");
  await coordinator.close();
});

test("priority coverage accepts migrated pins, protects lifetimes, and requires inspected sources", async (t) => {
  const f = await fixture(t, "maintenance");
  await f.store.transaction("a", (doc) => {
    const {
      instanceId: _id,
      section: _section,
      kept: _kept,
      source: _source,
      ...legacyPin
    } = doc.pins[0];
    doc.pins = pinDocumentSchema.parse({
      version: 2,
      workspaceId: "a",
      pins: [legacyPin],
    }).pins;
    assert.ok(doc.refresh);
    doc.refresh.scope = Object.fromEntries(doc.pins.map((p) => [p.key, p.instanceId]));
  });
  await f.context.prepare("a", f.worker, f.paseo);
  const source = present((await f.store.document("a")).refresh).sources[0].id;
  const pin = (await f.store.list("a"))[0];
  assert.match(pin.instanceId, /^legacy:/);
  const priority = {
    id: "preview",
    work: "Review current preview",
    reason: "Active review",
    sources: [source],
    outcome: "covered",
    pins: [{ key: pin.key, instanceId: pin.instanceId }],
    investigation: "The existing pin serves the active review.",
  };
  const report = {
    operationId: "coverage",
    reviewed: [{ key: pin.key, revision: pinRevision(pin) }],
    unverified: [],
    discovery: {
      complete: true,
      reviewedSources: [source],
      repositoryGaps: [],
      priorities: [priority],
    },
  };
  await assert.rejects(
    reportRefresh(
      f.store,
      "a",
      f.worker,
      refreshReportSchema.parse({
        ...report,
        discovery: {
          ...report.discovery,
          priorities: [{ ...priority, pins: [{ key: pin.key, instanceId: randomUUID() }] }],
        },
      }),
    ),
    /replaced pin/,
  );
  await reportRefresh(f.store, "a", f.worker, refreshReportSchema.parse(report));
  await f.store.transaction("a", (doc) => {
    assert.ok(doc.refresh);
    doc.refresh.sources[0].inspected = false;
  });
  await assert.rejects(
    applyRefresh(
      f.store,
      "a",
      f.worker,
      refreshApplySchema.parse({
        operationId: "unread",
        upsert: [
          {
            key: "new",
            title: "New",
            url: "https://new.example",
            expectedRevision: null,
            reason: "Found",
            sources: [source],
          },
        ],
      }),
      { agentId: f.worker, turnId: "test-turn", startedAt: new Date().toISOString() },
    ),
    /require/,
  );
});

test("resource mentions group repeated URLs without collapsing distinct queries or fragments", async () => {
  const { indexResources } = await import("../server/refresh-evidence");
  const index = new Map();
  for (let n = 0; n < 10; n++)
    indexResources(index, "See https://example.com/report?v=1#review", {
      sourceId: `source-${n}`,
      conversation: "Work",
      timestamp: null,
    });
  indexResources(
    index,
    "Current https://example.com/report?v=2#review and https://example.com/report?v=2#notes",
    { sourceId: "current", conversation: "Work", timestamp: null },
  );
  assert.equal(index.size, 3);
  assert.equal(index.get("https://example.com/report?v=1#review").mentions.length, 3);
});

test("page continuation can retrieve omitted work even when it has no URL", async (t) => {
  const f = await fixture(t, "maintenance");
  const rows = Array.from({ length: 30 }, (_, i) => ({
    item: {
      type: "assistant_message",
      text:
        i === 0
          ? "The audit findings are ready for review and need a decision."
          : `Progress note ${i}: ${"routine status ".repeat(80)}`,
    },
    seqStart: i + 1,
    seqEnd: i + 1,
    timestamp: "2026-11-12T10:00:00Z",
  }));
  const paseo = {
    agents: {
      ...f.paseo.agents,
      ref: () => ({
        refresh: async () => ({ agent: { workspaceId: "a", labels: {} } }),
        timeline: {
          refetch: async () => ({
            entries: rows,
            hasOlder: false,
            startCursor: { epoch: "epoch", seq: 1 },
            endCursor: { epoch: "epoch", seq: 30 },
            error: null,
          }),
        },
      }),
    },
  } as unknown as Paseo;
  await f.context.select("a", f.worker, paseo);
  let offset = 0;
  let found = false;
  for (let n = 0; n < 8; n++) {
    const page = await f.context.read("a", f.worker, paseo, { agentId: "thread-0", offset });
    assert.ok("entries" in page);
    found ||= page.entries.some((e) => e.text.includes("audit findings"));
    if (page.nextEntryOffset === null) break;
    offset = page.nextEntryOffset;
  }
  assert.equal(found, true);
});
