import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withPinGuidance } from "./server/guidance";
import { dataDirectory, PinStore } from "./server/store";
import { createPinTools } from "./server/tools";
import { acknowledgePins, listPins, pinSnapshot } from "./shared/pins";

export default function contribute(server: PluginServerContext) {
  const store = new PinStore(dataDirectory());
  const tools = createPinTools(store);
  server.handle(listPins, async ({ workspaceId }) => pinSnapshot(await store.list(workspaceId)));
  server.handle(acknowledgePins, ({ workspaceId, entries }) =>
    store.acknowledge(workspaceId, entries),
  );
  server.addHook("agent.open.before", async ({ request }) => {
    if (!request.workspaceId || request.purpose === "history") return;
    return { ...request, tools: [...request.tools, ...tools] };
  });
  server.addHook("agent.create.before", async ({ request }) => ({
    ...request,
    config: { ...request.config, systemPrompt: withPinGuidance(request.config.systemPrompt) },
  }));
  return () => store.close();
}
