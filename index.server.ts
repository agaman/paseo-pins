import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withPinGuidance } from "./server/guidance/pins";
import { type Paseo, workerLabel } from "./server/refresh/context";
import { RefreshCoordinator } from "./server/refresh/coordinator";
import { refreshGuidance } from "./server/refresh/guidance";
import { RefreshResults } from "./server/refresh/results";
import { createRefreshTools } from "./server/refresh/tools";
import { removeUserPin, undoUserRemoval } from "./server/removals";
import { dataDirectory, PinStore } from "./server/store";
import { PinTurns } from "./server/summaries/turns";
import { createPinTools } from "./server/tools";
import { acknowledgePins, listPins, removePin, setPinKept, undoPinRemoval } from "./shared/pin-rpc";
import {
  acknowledgeRefreshResult,
  cancelRefresh,
  listRefreshProfiles,
  readRefresh,
  refreshSettings,
  startRefresh,
} from "./shared/refresh";
import { acknowledgeSummary, readSummary } from "./shared/summaries";

export default function contribute(server: PluginServerContext) {
  let connection: Paseo | undefined;
  const store = new PinStore(dataDirectory(), undefined, async (workspaceId) => {
    const workspace = await connection?.workspaces.ref(workspaceId).refresh();
    if (!workspace || workspace.id !== workspaceId) throw new Error("Workspace is unavailable.");
    return workspace.workspaceDirectory;
  });
  const turns = new PinTurns(store);
  const refreshResults = new RefreshResults(store);
  const tools = createPinTools(store, turns);
  const settings = server.registerSettings(refreshSettings);
  const refresh = new RefreshCoordinator(store, async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values.profileId : null;
  });
  function connect(paseo: Paseo) {
    connection = paseo;
    refresh.connect(paseo);
  }
  const refreshTools = createRefreshTools(store, turns, refresh);
  server.handle(startRefresh, ({ workspaceId, requestId }, { paseo }) => {
    connect(paseo);
    return refresh.start(workspaceId, requestId, paseo);
  });
  server.handle(readRefresh, async ({ workspaceId }, { paseo }) => {
    connect(paseo);
    return {
      ...(await refreshResults.read(workspaceId)),
      configured: await refresh.configured(paseo),
    };
  });
  server.handle(acknowledgeRefreshResult, ({ workspaceId, runId, action }, { paseo }) => {
    connect(paseo);
    return refreshResults.acknowledge(workspaceId, runId, action);
  });
  server.handle(cancelRefresh, ({ workspaceId, runId }, { paseo }) => {
    connect(paseo);
    return refresh.cancel(workspaceId, runId);
  });
  server.handle(listRefreshProfiles, async (_, { paseo }) => ({
    profiles: (await refresh.profiles(paseo)).map(({ id, name, provider }) => ({
      id,
      name,
      provider,
    })),
  }));
  server.addHook("agent.permission.before", async ({ agent, request }, { paseo }) => {
    if (agent.workspaceId) await refresh.permission(agent.workspaceId, agent.id, request, paseo);
  });
  server.handle(listPins, async ({ workspaceId }, { paseo }) => {
    turns.connect(paseo);
    connect(paseo);
    return store.snapshot(workspaceId);
  });
  server.handle(setPinKept, ({ workspaceId, key, instanceId, kept }, { paseo }) => {
    connect(paseo);
    return store.setKept(workspaceId, key, instanceId, kept);
  });
  server.handle(removePin, ({ workspaceId, key, instanceId, requestId }, { paseo }) => {
    connect(paseo);
    return removeUserPin(store, workspaceId, key, instanceId, requestId);
  });
  server.handle(undoPinRemoval, ({ workspaceId, removalId }, { paseo }) => {
    connect(paseo);
    return undoUserRemoval(store, workspaceId, removalId);
  });
  server.handle(acknowledgePins, ({ workspaceId, entries }, { paseo }) => {
    connect(paseo);
    return store.acknowledge(workspaceId, entries);
  });
  server.handle(
    readSummary,
    async ({ workspaceId, agentId, summaryId, offset, limit }, { paseo }) => {
      turns.connect(paseo);
      connect(paseo);
      const summary = await store.summary(workspaceId, agentId, summaryId);
      if (!summary.endedAt || !summary.outcome) throw new Error("Pin summary is unavailable.");
      return {
        entries: summary.entries.slice(offset, offset + limit),
        total: summary.entries.length,
        unreadCount: summary.unreadCount,
        endedAt: summary.endedAt,
        startedAt: summary.startedAt,
        outcome: summary.outcome,
        recovered: summary.recovered,
      };
    },
  );
  server.handle(acknowledgeSummary, ({ workspaceId, agentId, summaryId }) =>
    store.acknowledgeSummary(workspaceId, agentId, summaryId),
  );
  server.addHook("agent.turn.before", async ({ agent, turnId }, { paseo }) => {
    connect(paseo);
    turns.begin(agent, turnId, paseo);
  });
  server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    connect(paseo);
    await turns
      .end(agent, turnId, outcome, paseo)
      .catch((error) => console.error("Pins summary publication will retry", error));
    if (agent.workspaceId)
      await refresh.finish(
        agent.workspaceId,
        agent.id,
        outcome.kind === "completed" ? undefined : "failed",
        outcome.kind === "completed"
          ? undefined
          : "The refresh turn stopped before completing its investigation.",
      );
  });
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    turns.connect(paseo);
    connect(paseo);
    if (request.workspaceId)
      void turns
        .recoverAgent(request.workspaceId, request.agentId, paseo, true)
        .catch((error) => console.error("Pins summary recovery will retry", error));
    if (!request.workspaceId || request.purpose === "history") return;
    const run = (await store.document(request.workspaceId)).refresh;
    const worker = Boolean(request.labels[workerLabel]) || run?.agentId === request.agentId;
    return { ...request, tools: [...request.tools, ...(worker ? refreshTools : tools)] };
  });
  server.addHook("agent.create.before", async ({ request }) => ({
    ...request,
    config: {
      ...request.config,
      systemPrompt:
        request.config.systemPrompt === refreshGuidance
          ? request.config.systemPrompt
          : withPinGuidance(request.config.systemPrompt),
    },
  }));
  return async () => {
    await refresh.close();
    await turns.close();
    await store.close();
  };
}
