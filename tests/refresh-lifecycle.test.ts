import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPaseoApi } from "@getpaseo/client";
import type { Paseo } from "../server/refresh-context";
import { RefreshCoordinator } from "../server/refresh-coordinator";
import { isRefreshToolPermission, type RefreshPermission } from "../server/refresh-permissions";
import { refreshToolNames } from "../server/refresh-tools";
import { PinStore } from "../server/store";

async function until(condition: () => Promise<boolean>) {
  for (let n = 0; n < 200; n++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Lifecycle condition was not reached.");
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "pins-lifecycle-"));
  const store = new PinStore(dir);
  const state = {
    launches: 0,
    archives: 0,
    deny: [] as string[],
    allow: [] as string[],
    archiveFails: false,
    available: true,
    providers: [{ provider: "codex", available: true }],
    providerError: null as string | null,
    modelError: null as string | null,
    modelReads: 0,
    models: [
      { id: "other-model", isDefault: false },
      { id: "default-model", isDefault: true },
    ],
    profileModel: undefined as string | undefined,
    recent: [] as {
      id: string;
      workspaceId: string;
      provider: string;
      model: string | null;
      labels: Record<string, string>;
      archivedAt: string | null;
    }[],
    launchConfig: null as unknown,
    worker: null as null | {
      id: string;
      workspaceId: string;
      labels: Record<string, string>;
      activeTurn: { turnId: string } | null;
      status: string;
      archivedAt: string | null;
      pendingPermissions: RefreshPermission[];
    },
  };
  // Exercise the real SDK conversion/validation, substituting only daemon transport.
  const sdk = createPaseoApi({
    getLastServerInfoMessage: () => ({ serverId: "test-host" }),
    supportsBackgroundWorkspaces: () => false,
    fetchWorkspaces: async () => ({
      entries: [{ id: "a", workspaceDirectory: "/tmp/pins-test" }],
      pageInfo: { nextCursor: null },
    }),
    createAgent: async (input: {
      agentId: string;
      workspaceId: string;
      labels: Record<string, string>;
      config: unknown;
    }) => {
      state.launches++;
      state.launchConfig = input.config;
      state.worker = {
        id: input.agentId,
        workspaceId: input.workspaceId,
        labels: input.labels,
        activeTurn: { turnId: "turn" },
        status: "running",
        archivedAt: null,
        pendingPermissions: [],
      };
      return state.worker;
    },
  } as unknown as Parameters<typeof createPaseoApi>[0]);
  const paseo = {
    config: {
      get: async () => ({
        config: {
          agentProfiles: state.available
            ? [{ id: "profile", name: "Profile", provider: "codex", model: state.profileModel }]
            : [],
        },
      }),
    },
    providers: {
      listAvailable: async () => ({ providers: state.providers, error: state.providerError }),
      listModels: async () => {
        state.modelReads++;
        return { models: state.models, error: state.modelError };
      },
    },
    workspaces: sdk.workspaces,
    agents: {
      list: async () => ({
        entries: state.recent.map((agent) => ({ agent })),
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      ref: (id: string) => ({
        refresh: async () => {
          const agent = state.recent.find((a) => a.id === id) ?? state.worker;
          return agent ? { agent } : null;
        },
        timeline: { refetch: async () => ({ entries: [], hasOlder: false, error: null }) },
        archive: async () => {
          state.archives++;
          if (state.archiveFails) throw new Error("Archive unavailable");
          assert.ok(state.worker);
          state.worker.archivedAt = new Date().toISOString();
          state.worker.activeTurn = null;
        },
        respondToPermission: async ({
          requestId,
          response,
        }: {
          requestId: string;
          response: { behavior: "allow" | "deny" };
        }) => {
          state[response.behavior].push(requestId);
          if (state.worker)
            state.worker.pendingPermissions = state.worker.pendingPermissions.filter(
              (p) => p.id !== requestId,
            );
        },
      }),
    },
  } as unknown as Paseo;
  const coordinators: RefreshCoordinator[] = [];
  const coordinator = (profileId: string | null = "profile") => {
    const value = new RefreshCoordinator(store, async () => profileId);
    coordinators.push(value);
    return value;
  };
  t.after(async () => {
    for (const value of coordinators) await value.close();
    await sdk.dispose();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, state, paseo, coordinator };
}

test("simultaneous starts and response retries share one reservation and worker", async (t) => {
  const f = await fixture(t),
    coordinator = f.coordinator();
  const requestId = randomUUID();
  const [a, b] = await Promise.all([
    coordinator.start("a", requestId, f.paseo),
    coordinator.start("a", randomUUID(), f.paseo),
  ]);
  assert.equal(a.id, b.id);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  assert.equal(f.state.launches, 1);
  assert.equal((await coordinator.start("a", requestId, f.paseo)).id, a.id);
  await coordinator.cancel("a", a.id);
  assert.equal((await f.store.document("a")).refresh?.outcome, "canceled");
  await until(async () => Boolean(f.state.worker?.archivedAt));
  assert.equal(f.state.launches, 1);
});

test("reload resumes observation without relaunch; missing final report is an error", async (t) => {
  const f = await fixture(t),
    first = f.coordinator();
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  assert.ok(f.state.worker);
  f.state.worker.activeTurn = null;
  f.state.worker.status = "idle";
  f.coordinator().connect(f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "finished");
  assert.equal((await f.store.document("a")).refresh?.outcome, "failed");
  assert.equal(f.state.launches, 1);
  assert.equal(f.state.archives, 1);
});

test("workers launch without a toolPolicy for the host-injected MCP server", async (t) => {
  for (const profileId of [null, "profile"]) {
    const f = await fixture(t);
    await f.coordinator(profileId).start("a", randomUUID(), f.paseo);
    await until(async () => (await f.store.document("a")).refresh?.state === "running");
    assert.equal((f.state.launchConfig as Record<string, unknown>).toolPolicy, undefined);
  }
});

function toolPermission(name: string): RefreshPermission {
  return {
    id: randomUUID(),
    provider: "codex",
    name: "CodexMcpElicitation",
    kind: "tool",
    description: `Allow the paseo MCP server to run tool "${name}"?`,
    metadata: { serverName: "paseo" },
    input: { mode: "form", requestedSchema: { type: "object", properties: {} }, url: null },
  };
}

test("owned active worker confirmations allow exactly the seven scoped tools once per request", async (t) => {
  const f = await fixture(t),
    coordinator = f.coordinator();
  await coordinator.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  const worker = f.state.worker;
  assert.ok(worker);
  for (const name of Object.values(refreshToolNames)) {
    const request = toolPermission(name);
    await Promise.all([
      coordinator.permission("a", worker.id, request, f.paseo),
      coordinator.permission("a", worker.id, request, f.paseo),
    ]);
  }
  assert.equal(f.state.allow.length, 7);
  assert.deepEqual(f.state.deny, []);
  assert.equal((await f.store.document("a")).refresh?.outcome, null);
  await coordinator.permission("a", "other-worker", toolPermission("pins_refresh_list"), f.paseo);
  assert.equal(f.state.allow.length, 7);
});

test("recovery resolves an outstanding scoped-tool confirmation without stopping refresh", async (t) => {
  const f = await fixture(t),
    first = f.coordinator();
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  assert.ok(f.state.worker);
  const request = toolPermission("pins_refresh_files_read");
  f.state.worker.pendingPermissions = [request];
  f.coordinator().connect(f.paseo);
  await until(async () => f.state.allow.includes(request.id));
  assert.equal((await f.store.document("a")).refresh?.outcome, null);
});

test("permission fallback denies the actual request ID after revoking writes", async (t) => {
  const f = await fixture(t),
    first = f.coordinator();
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  assert.ok(f.state.worker);
  f.state.worker.pendingPermissions = [
    { id: "permission-request", provider: "codex", name: "shell", kind: "tool" },
  ];
  f.coordinator().connect(f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "finished");
  assert.deepEqual(f.state.deny, ["permission-request"]);
  assert.equal((await f.store.document("a")).refresh?.outcome, "permission_limited");
});

test("expired persisted run times out on reconnect and cannot reset its deadline", async (t) => {
  const f = await fixture(t),
    first = f.coordinator();
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  await f.store.transaction("a", (d) => {
    assert.ok(d.refresh);
    d.refresh.deadline = new Date(0).toISOString();
  });
  f.coordinator().connect(f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "finished");
  assert.equal((await f.store.document("a")).refresh?.outcome, "timed_out");
  assert.equal(f.state.launches, 1);
});

test("unavailable saved profile never silently substitutes another worker", async (t) => {
  const f = await fixture(t);
  f.state.available = false;
  await assert.rejects(
    f.coordinator().start("a", randomUUID(), f.paseo),
    /selected profile is unavailable/,
  );
  assert.equal(f.state.launches, 0);
  assert.equal((await f.store.document("a")).refresh, null);
});

test("automatic refresh uses Paseo SDK with an explicit default model and no provider preference", async (t) => {
  const f = await fixture(t),
    coordinator = f.coordinator(null);
  f.state.available = false;
  f.state.providers = [
    { provider: "claude", available: true },
    { provider: "codex", available: true },
  ];
  assert.equal(await coordinator.configured(f.paseo), true);
  await coordinator.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  const config = f.state.launchConfig as Record<string, unknown>;
  assert.equal(config.provider, "claude");
  assert.equal(config.model, "default-model");
  assert.equal(config.modeId, undefined);
  assert.equal(config.thinkingOptionId, undefined);
  assert.equal(config.featureValues, undefined);
  assert.equal(
    (await f.store.document("a")).refresh?.profile.name,
    "Automatic · claude/default-model",
  );
});

test("automatic selection falls back deterministically and excludes unavailable providers", async (t) => {
  const f = await fixture(t);
  f.state.providers = [
    { provider: "codex", available: false },
    { provider: "z-provider", available: true },
    { provider: "claude", available: true },
  ];
  await f.coordinator(null).start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  assert.equal((f.state.launchConfig as Record<string, unknown>).provider, "claude");
});

test("automatic selection reports missing providers without reserving or launching a run", async (t) => {
  const f = await fixture(t),
    coordinator = f.coordinator(null);
  f.state.providers = [{ provider: "codex", available: false }];
  await assert.rejects(
    coordinator.start("a", randomUUID(), f.paseo),
    /No agent provider is available/,
  );
  assert.equal((await f.store.document("a")).refresh, null);
  assert.equal(f.state.launches, 0);
  f.state.providerError = "Discovery failed";
  await assert.rejects(coordinator.start("a", randomUUID(), f.paseo), /Could not check/);
});

test("SDK rejects a bare provider; model-less saved profiles resolve a catalog default", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.paseo.workspaces.ref("a").agents.create({ config: { provider: "codex" } }),
    /provider\/model/,
  );
  assert.equal(f.state.launches, 0);
  await f.coordinator().start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  assert.equal((f.state.launchConfig as Record<string, unknown>).model, "default-model");
});

test("automatic borrows the latest eligible workspace model and skips refresh, archived and other-workspace agents", async (t) => {
  const f = await fixture(t);
  f.state.providers = [
    { provider: "codex", available: true },
    { provider: "claude", available: true },
  ];
  const agent = {
    id: "recent",
    workspaceId: "a",
    provider: "codex",
    model: "current-model",
    labels: {},
    archivedAt: null,
  };
  f.state.recent = [
    { ...agent, id: "refresh", model: "wrong-refresh", labels: { "pins-refresh": "previous-run" } },
    { ...agent, id: "elsewhere", workspaceId: "b", model: "wrong-workspace" },
    { ...agent, id: "archived", archivedAt: new Date().toISOString(), model: "wrong-archive" },
    agent,
    { ...agent, id: "older", model: "older-model" },
  ];
  await f.coordinator(null).start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  const config = f.state.launchConfig as Record<string, unknown>;
  assert.equal(config.provider, "codex");
  assert.equal(config.model, "current-model");
  assert.equal(config.modeId, undefined);
  assert.equal(f.state.modelReads, 0);
});

test("explicit saved model takes precedence over workspace agents and model catalogs", async (t) => {
  const f = await fixture(t);
  f.state.profileModel = "chosen-model";
  f.state.modelError = "catalog unavailable";
  await f.coordinator().start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  assert.equal((f.state.launchConfig as Record<string, unknown>).model, "chosen-model");
  assert.equal(f.state.modelReads, 0);
});

test("missing default models fail before reserving a refresh", async (t) => {
  const f = await fixture(t);
  f.state.models = [];
  await assert.rejects(
    f.coordinator(null).start("a", randomUUID(), f.paseo),
    /No selectable model/,
  );
  assert.equal((await f.store.document("a")).refresh, null);
  f.state.modelError = "catalog unavailable";
  await assert.rejects(
    f.coordinator(null).start("a", randomUUID(), f.paseo),
    /Could not load models/,
  );
  assert.equal(f.state.launches, 0);
});

test("local SDK validation failures with no created worker clear pending cleanup before the deadline", async (t) => {
  const f = await fixture(t),
    first = f.coordinator(null);
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  f.state.worker = null;
  await f.store.transaction("a", (document) => {
    const run = document.refresh;
    assert.ok(run);
    run.state = "stopping";
    run.outcome = "failed";
    run.reason = 'Could not start refresh: Expected config.provider in "provider/model" format';
    run.cleanupPending = true;
    run.profile.provider = "codex";
  });
  f.coordinator(null).connect(f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "finished");
  assert.equal((await f.store.document("a")).refresh?.cleanupPending, false);
  assert.equal(f.state.archives, 0);
  assert.equal(f.state.launches, 1);
});

test("permission matcher rejects lookalikes, other servers, arbitrary forms, and non-tool requests", () => {
  const valid = toolPermission("pins_refresh_list");
  assert.equal(isRefreshToolPermission(valid), true);
  for (const name of ["paseo.pins_refresh_list", "mcp__paseo__pins_refresh_files_read"]) {
    assert.equal(isRefreshToolPermission({ ...valid, name }), true);
  }
  for (const request of [
    toolPermission("pins_refresh_list_extra"),
    toolPermission("create_agent"),
    { ...valid, name: "pins_refresh_list" },
    { ...valid, name: "mcp__other__pins_refresh_list" },
    { ...valid, kind: "question" as const },
    { ...valid, metadata: { serverName: "other" } },
    { ...valid, description: `${valid.description} And allow all other tools.` },
    { ...valid, input: { mode: "url", url: "https://example.com" } },
    {
      ...valid,
      input: {
        mode: "form",
        requestedSchema: { type: "object", properties: { secret: { type: "string" } } },
      },
    },
  ])
    assert.equal(isRefreshToolPermission(request), false);
});

test("terminal or expired refresh workers never receive tool approval", async (t) => {
  for (const terminal of [true, false]) {
    const f = await fixture(t),
      coordinator = f.coordinator();
    await coordinator.start("a", randomUUID(), f.paseo);
    await until(async () => (await f.store.document("a")).refresh?.state === "running");
    assert.ok(f.state.worker);
    await f.store.transaction("a", (doc) => {
      assert.ok(doc.refresh);
      if (terminal) doc.refresh.outcome = "canceled";
      else doc.refresh.deadline = new Date(0).toISOString();
    });
    await coordinator.permission(
      "a",
      f.state.worker.id,
      toolPermission("pins_refresh_list"),
      f.paseo,
    );
    assert.deepEqual(f.state.allow, []);
    assert.equal(f.state.deny.length, 1);
  }
});

test("rejected built-in server preapproval clears cleanup once worker absence is confirmed", async (t) => {
  const f = await fixture(t),
    first = f.coordinator();
  await first.start("a", randomUUID(), f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "running");
  await first.close();
  f.state.worker = null;
  await f.store.transaction("a", (doc) => {
    assert.ok(doc.refresh);
    doc.refresh.state = "stopping";
    doc.refresh.outcome = "failed";
    doc.refresh.reason =
      "Could not start refresh: toolPolicy preapproval 'paseo.pins_refresh_list' requires MCP server 'paseo' in the same agent request";
    doc.refresh.cleanupPending = true;
  });
  f.coordinator().connect(f.paseo);
  await until(async () => (await f.store.document("a")).refresh?.state === "finished");
  assert.equal((await f.store.document("a")).refresh?.cleanupPending, false);
});

test("mode is fixed at reservation from the initial pin count", async (t) => {
  for (const populated of [false, true]) {
    const f = await fixture(t);
    if (populated)
      await f.store.upsert("a", { key: "existing", title: "Existing", url: "https://example.com" });
    await f.coordinator().start("a", randomUUID(), f.paseo);
    const before = (await f.store.document("a")).refresh;
    assert.ok(before);
    assert.equal(before.discoveryVersion, 2);
    assert.equal(before.mode, populated ? "maintenance" : "discovery");
    await f.store.upsert("a", {
      key: "concurrent",
      title: "Concurrent",
      url: "https://example.org",
    });
    assert.equal((await f.store.document("a")).refresh?.mode, before.mode);
  }
});
