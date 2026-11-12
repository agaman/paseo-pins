import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentToolContext, PluginHookAgent } from "@getpaseo/plugin/server";
import { PinStore } from "../server/store";
import { providerTurnId } from "../server/turn-identity";
import { PinTurns } from "../server/turns";
import { isUnread } from "../shared/pins";
import { summaryEntryUnread } from "../shared/summaries";

const resource = {
  key: "preview",
  title: "Preview",
  url: "https://example.com/build-42",
  type: "app" as const,
};
const turn = (agentId = "agent-a", turnId = "turn-a") => ({
  agentId,
  turnId,
  startedAt: "2026-11-11T00:00:00.000Z",
});
const agent = (id = "agent-a"): PluginHookAgent => ({
  id,
  workspaceId: "workspace",
  provider: "test",
  cwd: "/tmp",
  title: "Test",
  parentAgentId: null,
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-summary-"));
  const store = new PinStore(directory);
  const coordinators: PinTurns[] = [];
  t.after(async () => {
    for (const coordinator of coordinators) await coordinator.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    store,
    directory,
    coordinator: () => {
      const value = new PinTurns(store);
      coordinators.push(value);
      return value;
    },
  };
}

function fakePaseo() {
  const active = new Map<string, string>();
  const starts = new Map<string, string | null>();
  const rows = new Map<string, { id: string; type: "plugin"; pluginId: string }[]>();
  let failAppend = false;
  let appends = 0;
  const paseo = {
    agents: {
      ref: (id: string) => ({
        refresh: async () => ({
          agent: {
            id,
            workspaceId: "workspace",
            activeTurn: active.has(id)
              ? {
                  turnId: active.get(id),
                  startedAt: starts.has(id) ? starts.get(id) : turn().startedAt,
                }
              : null,
          },
        }),
        timeline: {
          refetch: async () => ({
            entries: (rows.get(id) ?? []).map((item) => ({ item })),
            hasOlder: false,
            staleCursor: false,
            gap: false,
          }),
          append: async (item: { id: string; type: "plugin" }) => {
            if (failAppend) throw new Error("Offline");
            appends++;
            rows.set(id, [
              ...(rows.get(id) ?? []).filter((row) => row.id !== item.id),
              { ...item, pluginId: "paseo-pins" },
            ]);
            return { seq: appends, epoch: "test" };
          },
        },
      }),
    },
  } as unknown as AgentToolContext["paseo"];
  return {
    paseo,
    active,
    starts,
    rows,
    fail: (value: boolean) => {
      failAppend = value;
    },
    appends: () => appends,
  };
}

test("consolidates notifications, keeps final own-turn snapshot and freezes history", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn());
  await store.upsert(
    "workspace",
    { ...resource, title: "Final title", notify: { id: "ready", reason: "Ready to review" } },
    undefined,
    turn(),
  );
  await store.upsert(
    "workspace",
    { ...resource, title: "Final title", url: "https://example.com/build-43" },
    undefined,
    turn(),
  );
  const summary = await store.finalize("workspace", "agent-a", "turn-a", "completed");
  assert.equal(summary?.entries.length, 1);
  assert.equal(summary?.entries[0].kind, "added");
  assert.equal(summary?.entries[0].url, "https://example.com/build-43");
  assert.equal(summary?.entries[0].reason, "Ready to review");
  await store.upsert(
    "workspace",
    { ...resource, title: "Later" },
    undefined,
    turn("agent-b", "turn-b"),
  );
  assert.deepEqual(await store.finalize("workspace", "agent-a", "turn-a", "interrupted"), summary);
  await store.remove("workspace", resource.key);
  assert.equal(
    (await store.summary("workspace", "agent-a", summary?.id ?? "")).entries[0].title,
    "Final title",
  );
  await assert.rejects(store.summary("workspace", "agent-b", summary?.id ?? ""), /unavailable/);
});

test("routine edits and duplicate notifications do not generate summaries", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("workspace", {
    ...resource,
    notify: { id: "event", reason: "Ready to review" },
  });
  await store.upsert(
    "workspace",
    { ...resource, title: "Renamed", notify: { id: "event", reason: "Ready to review" } },
    undefined,
    turn(),
  );
  assert.equal((await store.summaries("workspace")).length, 0);
  await store.upsert(
    "workspace",
    { ...resource, notify: { id: "next", reason: "Ready to review" } },
    undefined,
    turn(),
  );
  assert.equal(
    (await store.finalize("workspace", "agent-a", "turn-a", "completed"))?.entries[0].kind,
    "updated",
  );
});

test("remove/recreate has a new lifetime; create/remove produces no visible summary", async (t) => {
  const { store } = await fixture(t);
  const first = await store.upsert("workspace", resource, undefined, turn());
  await store.remove("workspace", resource.key, undefined, turn());
  const second = await store.upsert("workspace", resource, undefined, turn());
  assert.notEqual(first.pin.instanceId, second.pin.instanceId);
  const summary = await store.finalize("workspace", "agent-a", "turn-a", "completed");
  assert.deepEqual(
    summary?.entries.map((entry) => entry.instanceId),
    [second.pin.instanceId],
  );
  await store.upsert(
    "workspace",
    { ...resource, key: "temporary" },
    undefined,
    turn("agent-b", "turn-b"),
  );
  await store.remove("workspace", "temporary");
  assert.equal(
    (await store.finalize("workspace", "agent-b", "turn-b", "interrupted"))?.entries.length,
    0,
  );
});

test("concurrent agents retain their own snapshots and stale summaries cannot clear newer updates", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn());
  await store.upsert(
    "workspace",
    { ...resource, title: "Other agent", notify: { id: "other", reason: "Ready to review" } },
    undefined,
    turn("agent-b", "turn-b"),
  );
  const a = await store.finalize("workspace", "agent-a", "turn-a", "completed");
  const b = await store.finalize("workspace", "agent-b", "turn-b", "completed");
  assert.ok(a && b);
  assert.equal(a.entries[0].title, "Preview");
  assert.equal(b.entries[0].title, "Other agent");
  assert.equal(summaryEntryUnread(a.entries[0], await store.list("workspace")), false);
  assert.equal((await store.acknowledgeSummary("workspace", "agent-a", a.id)).acknowledged, 0);
  assert.equal((await store.acknowledgeSummary("workspace", "agent-b", b.id)).acknowledged, 1);
});

test("summary acknowledgment covers collapsed entries, preserves newer updates and other pins", async (t) => {
  const { store } = await fixture(t);
  await store.apply("workspace", {
    upsert: Array.from({ length: 30 }, (_, i) => ({ ...resource, key: `pin-${i}` })),
  });
  await store.apply(
    "workspace",
    {
      upsert: Array.from({ length: 30 }, (_, i) => ({
        ...resource,
        key: `pin-${i}`,
        notify: { id: "ready", reason: "Ready to review" },
      })),
    },
    undefined,
    turn(),
  );
  const summary = await store.finalize("workspace", "agent-a", "turn-a", "completed");
  assert.ok(summary);
  await store.upsert("workspace", resource);
  await store.upsert("workspace", {
    ...resource,
    notify: { id: "unrelated-update", reason: "Ready to review" },
  });
  await store.upsert("workspace", {
    ...resource,
    key: "pin-29",
    notify: { id: "newer", reason: "Ready to review" },
  });
  assert.equal((await store.summary("workspace", "agent-a", summary.id)).unreadCount, 29);
  assert.equal(
    (await store.acknowledgeSummary("workspace", "agent-a", summary.id)).acknowledged,
    29,
  );
  assert.equal((await store.summary("workspace", "agent-a", summary.id)).unreadCount, 0);
  const pins = await store.list("workspace");
  assert.ok(pins.filter(isUnread).every((pin) => ["preview", "pin-29"].includes(pin.key)));
});

test("failed or canceled mutations preserve both pins and journal atomically", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn());
  const file = store.filePath("workspace");
  const before = await readFile(file, "utf8");
  await chmod(path.dirname(file), 0o500);
  try {
    await assert.rejects(
      store.upsert(
        "workspace",
        { ...resource, notify: { id: "failed", reason: "Ready to review" } },
        undefined,
        turn(),
      ),
      /Could not save/,
    );
  } finally {
    await chmod(path.dirname(file), 0o700);
  }
  assert.equal(await readFile(file, "utf8"), before);
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(
    store.upsert("workspace", resource, cancellation.signal, turn()),
    /canceled/,
  );
  assert.equal(await readFile(file, "utf8"), before);
});

test("turn end waits for started writes, publishes to child conversation only, and deduplicates", async (t) => {
  const { store, coordinator } = await fixture(t);
  const turns = coordinator();
  const host = fakePaseo();
  const child = { ...agent(), parentAgentId: "parent" };
  host.active.set(child.id, "turn-a");
  turns.begin(child, "turn-a", host.paseo);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = turns.run(
    { agent: child, paseo: host.paseo, signal: new AbortController().signal },
    async (identity) => {
      await gate;
      return store.upsert("workspace", resource, undefined, identity);
    },
  );
  const ending = turns.end(child, "turn-a", { kind: "canceled", reason: "Stopped" }, host.paseo);
  release();
  await writing;
  await ending;
  await turns.end(child, "turn-a", { kind: "completed" }, host.paseo);
  assert.equal(host.appends(), 1);
  assert.equal(host.rows.get("parent"), undefined);
  assert.equal((await store.summaries("workspace"))[0].outcome, "interrupted");
});

test("missing turn identity rejects before any write; snapshot fallback captures provenance", async (t) => {
  const { store, coordinator } = await fixture(t);
  const turns = coordinator();
  const host = fakePaseo();
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  await assert.rejects(
    turns.run(context, (identity) => store.upsert("workspace", resource, undefined, identity)),
    /active turn/,
  );
  assert.deepEqual(await store.list("workspace"), []);
  host.active.set("agent-a", "fallback");
  await turns.run(context, (identity) => store.upsert("workspace", resource, undefined, identity));
  assert.equal(providerTurnId((await store.summaries("workspace"))[0].turnId), "fallback");
});

test("failed append leaves committed pins and retries as recovered without duplicate rows", async (t) => {
  const { store, coordinator } = await fixture(t);
  const turns = coordinator();
  const host = fakePaseo();
  host.active.set("agent-a", "turn-a");
  turns.begin(agent(), "turn-a", host.paseo);
  await turns.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) => store.upsert("workspace", resource, undefined, identity),
  );
  host.fail(true);
  await assert.rejects(turns.end(agent(), "turn-a", { kind: "completed" }, host.paseo), /Offline/);
  assert.equal((await store.list("workspace")).length, 1);
  assert.equal((await store.summaries("workspace"))[0].published, false);
  host.fail(false);
  host.active.clear();
  const restored = coordinator();
  await restored.recoverAgent("workspace", "agent-a", host.paseo);
  await restored.recoverAgent("workspace", "agent-a", host.paseo, true);
  assert.equal(host.appends(), 1);
  assert.equal((await store.summaries("workspace"))[0].recovered, true);
});

test("recovery waits for an active turn and repairs missing host rows after a restart", async (t) => {
  const { store, coordinator } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn());
  const host = fakePaseo();
  host.active.set("agent-a", "turn-a");
  const restored = coordinator();
  await restored.recoverAgent("workspace", "agent-a", host.paseo);
  assert.equal(host.appends(), 0);
  host.active.clear();
  await restored.recoverAgent("workspace", "agent-a", host.paseo);
  assert.equal((await store.summaries("workspace"))[0].outcome, "interrupted");
  host.rows.clear();
  const restarted = coordinator();
  await restarted.recoverAgent("workspace", "agent-a", host.paseo);
  assert.equal(host.appends(), 2);
  assert.equal(host.rows.get("agent-a")?.length, 1);
});

test("late and nullable end events do not finalize a newer active turn", async (t) => {
  const { store, coordinator } = await fixture(t);
  const turns = coordinator();
  const host = fakePaseo();
  await store.upsert("workspace", resource, undefined, turn());
  await store.finalize("workspace", "agent-a", "turn-a", "completed");
  host.active.set("agent-a", "turn-b");
  turns.begin(agent(), "turn-b", host.paseo);
  await turns.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) =>
      store.upsert(
        "workspace",
        { ...resource, notify: { id: "turn-b", reason: "Ready to review" } },
        undefined,
        identity,
      ),
  );
  await turns.end(agent(), "turn-a", { kind: "completed" }, host.paseo);
  await turns.end(agent(), null, { kind: "completed" }, host.paseo);
  assert.equal(
    (await store.summaries("workspace")).find(
      (summary) => providerTurnId(summary.turnId) === "turn-b",
    )?.endedAt,
    null,
  );
  host.active.clear();
  await turns.end(agent(), "turn-b", { kind: "failed", error: { message: "Stopped" } }, host.paseo);
  assert.equal(
    (await store.summaries("workspace")).find(
      (summary) => providerTurnId(summary.turnId) === "turn-b",
    )?.outcome,
    "interrupted",
  );
});

test("read additions still get historical summaries and never acknowledge a later update", async (t) => {
  const { store } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn());
  const summary = await store.finalize("workspace", "agent-a", "turn-a", "completed");
  assert.ok(summary);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].kind, "added");
  assert.equal(summary.entries[0].attentionToken, null);
  assert.equal((await store.summary("workspace", "agent-a", summary.id)).unreadCount, 0);
  await store.upsert("workspace", {
    ...resource,
    notify: { id: "later", reason: "Ready to review" },
  });
  assert.equal(summaryEntryUnread(summary.entries[0], await store.list("workspace")), false);
  assert.equal(
    (await store.acknowledgeSummary("workspace", "agent-a", summary.id)).acknowledged,
    0,
  );
  assert.equal(isUnread((await store.list("workspace"))[0]), true);
});

test("recovery defers to completion received while its host snapshot is in flight", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo();
  const turns = coordinator();
  host.active.set("agent-a", "turn-a");
  turns.begin(agent(), "turn-a", host.paseo);
  await turns.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) => store.upsert("workspace", resource, undefined, identity),
  );
  host.active.clear();
  let requested = () => {};
  const refreshing = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ref = host.paseo.agents.ref;
  host.paseo.agents.ref = (id) => {
    const agentRef = ref(id);
    const refresh = agentRef.refresh;
    agentRef.refresh = async () => {
      requested();
      await gate;
      return refresh();
    };
    return agentRef;
  };
  const recovering = turns.recoverAgent("workspace", "agent-a", host.paseo);
  await refreshing;
  const ending = turns.end(agent(), "turn-a", { kind: "completed" }, host.paseo);
  release();
  await Promise.all([recovering, ending]);
  const [summary] = await store.summaries("workspace");
  assert.equal(summary.outcome, "completed");
  assert.equal(summary.recovered, false);
  assert.equal(host.appends(), 1);
});

test("local turn start protects against a temporarily stale inactive host snapshot", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo();
  const turns = coordinator();
  host.active.set("agent-a", "turn-a");
  turns.begin(agent(), "turn-a", host.paseo);
  await turns.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) => store.upsert("workspace", resource, undefined, identity),
  );
  host.active.clear();
  await turns.recoverAgent("workspace", "agent-a", host.paseo);
  assert.equal((await store.summaries("workspace"))[0].endedAt, null);
  await turns.end(agent(), "turn-a", { kind: "completed" }, host.paseo);
  assert.equal((await store.summaries("workspace"))[0].outcome, "completed");
});

test("a provider can reuse a completed turn ID after restarting its session", async (t) => {
  const { store, coordinator } = await fixture(t);
  await store.upsert("workspace", resource, undefined, turn("agent-a", "codex-turn-0"));
  const historical = await store.finalize("workspace", "agent-a", "codex-turn-0", "completed");
  const host = fakePaseo();
  host.active.set("agent-a", "codex-turn-0");
  const originalRef = host.paseo.agents.ref;
  host.paseo.agents.ref = (id) => {
    const ref = originalRef(id);
    ref.refresh = async () =>
      ({
        agent: {
          workspaceId: "workspace",
          activeTurn: {
            turnId: "codex-turn-0",
            startedAt: "2026-11-12T01:42:01.400Z",
          },
        },
      }) as Awaited<ReturnType<typeof ref.refresh>>;
    return ref;
  };
  const turns = coordinator();
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  await turns.run(context, (identity) =>
    store.upsert(
      "workspace",
      {
        ...resource,
        notify: { id: "new-session-update", reason: "Ready after restart" },
      },
      undefined,
      identity,
    ),
  );
  await turns.end(agent(), "codex-turn-0", { kind: "completed" }, host.paseo);
  const summaries = await store.summaries("workspace");
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].id, historical?.id);
  assert.equal(summaries[0].endedAt, historical?.endedAt);
  assert.deepEqual(summaries[0].entries, historical?.entries);
  assert.notEqual(summaries[0].id, summaries[1].id);
  assert.equal(summaries[1].startedAt, "2026-11-12T01:42:01.400Z");
  assert.equal(summaries[1].outcome, "completed");
  assert.equal(summaries[1].entries[0].reason, "Ready after restart");
});

test("distinct starts with the same provider ID produce separate completed summaries", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo(),
    turns = coordinator();
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  host.active.set("agent-a", "codex-turn-0");
  for (const [i, start] of ["2026-11-12T01:00:00.000Z", "2026-11-12T02:00:00.000Z"].entries()) {
    host.starts.set("agent-a", start);
    turns.begin(agent(), "codex-turn-0", host.paseo);
    await turns.run(context, (identity) =>
      store.upsert("workspace", { ...resource, key: `pin-${i}` }, undefined, identity),
    );
    await turns.end(agent(), "codex-turn-0", { kind: "completed" }, host.paseo);
  }
  const summaries = await store.summaries("workspace");
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((s) => s.outcome === "completed"));
  assert.equal(new Set(summaries.map((s) => s.id)).size, 2);
  assert.equal(host.appends(), 2);
});

test("plugin reload during a turn reuses the exact summary and deduplicates notifications", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo(),
    first = coordinator();
  host.active.set("agent-a", "codex-turn-0");
  host.starts.set("agent-a", "2026-11-12T02:00:00.000Z");
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  first.begin(agent(), "codex-turn-0", host.paseo);
  await first.run(context, (identity) => store.upsert("workspace", resource, undefined, identity));
  const input = { ...resource, notify: { id: "event", reason: "Ready" } };
  await first.run(context, (identity) => store.upsert("workspace", input, undefined, identity));
  const [before] = await store.summaries("workspace");
  await first.close();
  const resumed = coordinator();
  await resumed.recoverAgent("workspace", "agent-a", host.paseo);
  const retried = await resumed.run(context, (identity) =>
    store.upsert("workspace", input, undefined, identity),
  );
  assert.equal(retried.notified, false);
  assert.deepEqual(await store.summaries("workspace"), [before]);
  await resumed.end(agent(), "codex-turn-0", { kind: "completed" }, host.paseo);
  assert.equal(host.appends(), 1);
  assert.equal((await store.summaries("workspace"))[0].outcome, "completed");
});

test("recovery distinguishes an abandoned instance from a new instance with the same ID", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo();
  host.active.set("agent-a", "codex-turn-0");
  host.starts.set("agent-a", "2026-11-12T01:00:00.000Z");
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  const first = coordinator();
  await first.run(context, (identity) => store.upsert("workspace", resource, undefined, identity));
  await first.close();
  host.starts.set("agent-a", "2026-11-12T02:00:00.000Z");
  const second = coordinator();
  await second.run(context, (identity) =>
    store.upsert("workspace", { ...resource, key: "second" }, undefined, identity),
  );
  await second.recoverAgent("workspace", "agent-a", host.paseo);
  const summaries = await store.summaries("workspace");
  assert.equal(summaries[0].outcome, "interrupted");
  assert.equal(summaries[1].outcome, null);
  await second.end(agent(), "codex-turn-0", { kind: "completed" }, host.paseo);
  assert.equal((await store.summaries("workspace"))[1].outcome, "completed");
});

test("missing start time fails without writing and a later valid snapshot is retryable", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo(),
    turns = coordinator();
  host.active.set("agent-a", "codex-turn-0");
  host.starts.set("agent-a", null);
  const context = { agent: agent(), paseo: host.paseo, signal: new AbortController().signal };
  const write = () =>
    turns.run(context, (identity) => store.upsert("workspace", resource, undefined, identity));
  await assert.rejects(write(), /start time/);
  assert.deepEqual(await store.list("workspace"), []);
  host.starts.set("agent-a", "2026-11-12T02:00:00.000Z");
  await write();
  assert.equal((await store.list("workspace")).length, 1);
});

test("recovery preserves an active summary when its host start time is unavailable", async (t) => {
  const { store, coordinator } = await fixture(t);
  const host = fakePaseo();
  host.active.set("agent-a", "codex-turn-0");
  const first = coordinator();
  await first.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) => store.upsert("workspace", resource, undefined, identity),
  );
  await first.close();
  const resumed = coordinator();
  for (const startedAt of [null, "invalid"]) {
    host.starts.set("agent-a", startedAt);
    await resumed.recoverAgent("workspace", "agent-a", host.paseo);
    assert.equal((await store.summaries("workspace"))[0].endedAt, null);
    assert.equal(host.appends(), 0);
  }
  host.active.clear();
  await resumed.recoverAgent("workspace", "agent-a", host.paseo);
  assert.equal((await store.summaries("workspace"))[0].outcome, "interrupted");
});

test("upgrading during an open legacy turn preserves its journal ID", async (t) => {
  const { store, coordinator } = await fixture(t);
  // Legacy hook receipt was a few milliseconds after the host's actual turn start.
  const legacy = { ...turn(), startedAt: "2026-11-11T00:00:00.010Z" };
  await store.upsert("workspace", resource, undefined, legacy);
  const [before] = await store.summaries("workspace");
  const host = fakePaseo();
  host.active.set("agent-a", "turn-a");
  const turns = coordinator();
  await turns.run(
    { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
    (identity) => store.upsert("workspace", { ...resource, key: "second" }, undefined, identity),
  );
  const summaries = await store.summaries("workspace");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, before.id);
  assert.equal(summaries[0].entries.length, 2);
  await turns.end(agent(), "turn-a", { kind: "completed" }, host.paseo);
  assert.equal((await store.summaries("workspace"))[0].outcome, "completed");
});

for (const observedBegin of [true, false]) {
  test(`a reused ID without pin calls cannot complete abandoned work (${observedBegin ? "observed begin" : "reloaded"})`, async (t) => {
    const { store, coordinator } = await fixture(t);
    const host = fakePaseo();
    host.active.set("agent-a", "codex-turn-0");
    const first = coordinator();
    await first.run(
      { agent: agent(), paseo: host.paseo, signal: new AbortController().signal },
      (identity) => store.upsert("workspace", resource, undefined, identity),
    );
    await first.close();
    host.starts.set("agent-a", "2026-11-12T02:00:00.000Z");
    const resumed = coordinator();
    if (observedBegin) {
      resumed.begin(agent(), "codex-turn-0", host.paseo);
      await resumed.recoverAgent("workspace", "agent-a", host.paseo);
      assert.equal((await store.summaries("workspace"))[0].outcome, "interrupted");
    }
    host.active.clear();
    await resumed.end(agent(), "codex-turn-0", { kind: "completed" }, host.paseo);
    const [summary] = await store.summaries("workspace");
    assert.equal(summary.outcome, "interrupted");
    assert.equal(summary.recovered, true);
    assert.equal(host.appends(), 1);
  });
}
