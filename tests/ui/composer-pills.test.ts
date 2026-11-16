import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PluginButton,
  PluginClientContext,
  PluginComposerPillContribution,
} from "@getpaseo/plugin/client";
import { registerComposerPills } from "../../client/menu/composer-pills";

type Agent = { id: string; workspaceId?: string; archivedAt?: string };
type Listener = {
  snapshot(value: { entries: { agent: Agent }[] }): void;
  update(value: {
    type: "agent_update";
    payload: { kind: "upsert"; agent: Agent } | { kind: "remove"; agentId: string };
  }): void;
};

function fixture() {
  let listener: Listener | undefined;
  let resolve!: (value: unknown) => void;
  let released = 0;
  let signal: AbortSignal | undefined;
  const records: {
    contribution: PluginComposerPillContribution;
    onCount: (count: number) => void;
    updates: Partial<PluginButton>[];
    removed: number;
  }[] = [];
  let onCount: (count: number) => void;
  const client = {
    paseo: {
      agents: {
        list(options: { signal: AbortSignal; scope: string; sync: unknown }) {
          signal = options.signal;
          assert.equal(options.scope, "active");
          assert.deepEqual(options.sync, {});
          return new Promise((done) => {
            resolve = done;
          });
        },
      },
    },
    addComposerPill(contribution: PluginComposerPillContribution) {
      const record = { contribution, onCount, updates: [] as Partial<PluginButton>[], removed: 0 };
      records.push(record);
      return {
        update(patch: Partial<PluginButton>) {
          record.updates.push(patch);
        },
        remove() {
          record.removed++;
        },
      };
    },
  } as unknown as PluginClientContext;
  const stop = registerComposerPills(client, (count) => {
    onCount = count;
    return {
      title: "Pins",
      label: "Pins",
      icon: "Pin",
      behavior: { kind: "action", onPress() {} },
    };
  });
  return {
    records,
    stop,
    get released() {
      return released;
    },
    get aborted() {
      return signal?.aborted;
    },
    async start() {
      resolve({
        subscription: {
          subscribe(callbacks: Listener) {
            listener = callbacks;
          },
          release() {
            released++;
          },
        },
      });
      await Promise.resolve();
    },
    snapshot(agents: Agent[]) {
      listener?.snapshot({ entries: agents.map((agent) => ({ agent })) });
    },
    upsert(agent: Agent) {
      listener?.update({ type: "agent_update", payload: { kind: "upsert", agent } });
    },
    remove(agentId: string) {
      listener?.update({ type: "agent_update", payload: { kind: "remove", agentId } });
    },
  };
}

test("pills follow agent membership while status updates preserve registration and unread label", async () => {
  const f = fixture();
  await f.start();
  f.snapshot([{ id: "a", workspaceId: "w" }, { id: "missing-workspace" }]);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].contribution.agentId, "a");
  f.records[0].onCount(3);
  f.upsert({ id: "a", workspaceId: "w" });
  f.records[0].onCount(3);
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.records[0].updates, [{ label: "Pins (3)", title: "Pins (3)" }]);
  f.records[0].onCount(0);
  assert.deepEqual(f.records[0].updates.at(-1), { label: "Pins", title: "Pins" });
  f.upsert({ id: "b", workspaceId: "w" });
  assert.equal(f.records.length, 2);
  f.upsert({ id: "a", workspaceId: "other" });
  assert.equal(f.records[0].removed, 1);
  assert.equal(f.records[2].contribution.workspaceId, "other");
  f.records[0].onCount(8);
  assert.equal(f.records[2].updates.length, 0, "stale icon cannot update replacement");
  f.remove("b");
  f.upsert({ id: "a", workspaceId: "other", archivedAt: "now" });
  assert.equal(f.records[1].removed, 1);
  assert.equal(f.records[2].removed, 1);
  f.stop();
});

test("reconnect snapshots remove stale pills and disposal rejects late callbacks", async () => {
  const f = fixture();
  await f.start();
  f.snapshot([
    { id: "a", workspaceId: "w" },
    { id: "b", workspaceId: "w" },
  ]);
  f.snapshot([{ id: "b", workspaceId: "w" }]);
  assert.equal(f.records[0].removed, 1);
  assert.equal(f.records.length, 2);
  f.stop();
  assert.equal(f.released, 1);
  assert.equal(f.aborted, true);
  assert.equal(f.records[1].removed, 1);
  f.upsert({ id: "late", workspaceId: "w" });
  f.snapshot([{ id: "later", workspaceId: "w" }]);
  f.records[1].onCount(2);
  assert.equal(f.records.length, 2);
  assert.equal(f.records[1].updates.length, 0);
});

test("unloading during bootstrap releases the late subscription without registering pills", async () => {
  const f = fixture();
  f.stop();
  await f.start();
  assert.equal(f.aborted, true);
  assert.equal(f.released, 1);
  f.snapshot([{ id: "a", workspaceId: "w" }]);
  assert.equal(f.records.length, 0);
});
