import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withPinGuidance } from "./server/guidance";
import { dataDirectory, PinStore } from "./server/store";
import { createPinTools } from "./server/tools";
import { PinTurns } from "./server/turns";
import { acknowledgePins, listPins } from "./shared/pins";
import { acknowledgeSummary, readSummary } from "./shared/summaries";

export default function contribute(server: PluginServerContext) {
  const store = new PinStore(dataDirectory());
  const turns = new PinTurns(store);
  const tools = createPinTools(store, turns);
  server.handle(listPins, async ({ workspaceId }, { paseo }) => {
    turns.connect(paseo);
    return store.snapshot(workspaceId);
  });
  server.handle(acknowledgePins, ({ workspaceId, entries }) =>
    store.acknowledge(workspaceId, entries),
  );
  server.handle(
    readSummary,
    async ({ workspaceId, agentId, summaryId, offset, limit }, { paseo }) => {
      turns.connect(paseo);
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
    turns.begin(agent, turnId, paseo);
  });
  server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    await turns
      .end(agent, turnId, outcome, paseo)
      .catch((error) => console.error("Pins summary publication will retry", error));
  });
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    turns.connect(paseo);
    if (request.workspaceId)
      void turns
        .recoverAgent(request.workspaceId, request.agentId, paseo, true)
        .catch((error) => console.error("Pins summary recovery will retry", error));
    if (!request.workspaceId || request.purpose === "history") return;
    return { ...request, tools: [...request.tools, ...tools] };
  });
  server.addHook("agent.create.before", async ({ request }) => ({
    ...request,
    config: { ...request.config, systemPrompt: withPinGuidance(request.config.systemPrompt) },
  }));
  return async () => {
    await turns.close();
    await store.close();
  };
}
