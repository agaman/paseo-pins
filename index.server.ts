import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withPinGuidance } from "./server/guidance";
import { workerLabel } from "./server/refresh-context";
import { RefreshCoordinator } from "./server/refresh-coordinator";
import { refreshGuidance } from "./server/refresh-guidance";
import { createRefreshTools } from "./server/refresh-tools";
import { dataDirectory, PinStore } from "./server/store";
import { createPinTools } from "./server/tools";
import { PinTurns } from "./server/turns";
import { acknowledgePins, listPins } from "./shared/pins";
import {
  cancelRefresh,
  listRefreshProfiles,
  readRefresh,
  refreshSettings,
  refreshView,
  startRefresh,
} from "./shared/refresh";
import { acknowledgeSummary, readSummary } from "./shared/summaries";

export default function contribute(server: PluginServerContext) {
  const store = new PinStore(dataDirectory());
  const turns = new PinTurns(store);
  const tools = createPinTools(store, turns);
  const settings = server.registerSettings(refreshSettings);
  const refresh = new RefreshCoordinator(store, async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values.profileId : null;
  });
  const refreshTools = createRefreshTools(store, turns, refresh);
  server.handle(startRefresh, ({ workspaceId, requestId }, { paseo }) =>
    refresh.start(workspaceId, requestId, paseo),
  );
  server.handle(readRefresh, async ({ workspaceId }, { paseo }) => {
    refresh.connect(paseo);
    return {
      run: refreshView((await store.document(workspaceId)).refresh),
      configured: await refresh.configured(paseo),
    };
  });
  server.handle(cancelRefresh, ({ workspaceId, runId }, { paseo }) => {
    refresh.connect(paseo);
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
    refresh.connect(paseo);
    return store.snapshot(workspaceId);
  });
  server.handle(acknowledgePins, ({ workspaceId, entries }) =>
    store.acknowledge(workspaceId, entries),
  );
  server.handle(
    readSummary,
    async ({ workspaceId, agentId, summaryId, offset, limit }, { paseo }) => {
      turns.connect(paseo);
      refresh.connect(paseo);
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
    refresh.connect(paseo);
    turns.begin(agent, turnId, paseo);
  });
  server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    refresh.connect(paseo);
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
    refresh.connect(paseo);
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
