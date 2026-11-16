import { refreshProfileSchema } from "../../shared/refresh-state";
import { type Paseo, workerLabel } from "./context";

async function modelSelection(paseo: Paseo, provider: string, model?: string | null) {
  if (model) return `${provider}/${model}`;
  const catalog = await paseo.providers.listModels(provider);
  if (catalog.error) throw new Error(`Could not load models for ${provider}. Try again.`);
  const models = (catalog.models ?? []).filter((entry) => entry.isSelectable !== false);
  const selected = models.find((entry) => entry.isDefault) ?? models[0];
  if (!selected) throw new Error(`No selectable model is available for ${provider}.`);
  return `${provider}/${selected.id}`;
}

export async function resolveRefreshProfile(
  paseo: Paseo,
  workspaceId: string,
  profileId: string | null,
) {
  if (profileId !== null) {
    const { config } = await paseo.config.get();
    const selected = config.agentProfiles?.find((profile) => profile.id === profileId);
    if (!selected)
      throw new Error(
        "The selected profile is unavailable. Choose Automatic in Pins settings or select another profile.",
      );
    return refreshProfileSchema.parse({
      id: selected.id,
      name: selected.name,
      provider: await modelSelection(paseo, selected.provider, selected.model),
      modeId: selected.modeId,
      thinkingOptionId: selected.thinkingOptionId,
      featureValues: selected.featureValues,
    });
  }
  const availability = await paseo.providers.listAvailable();
  if (availability.error) throw new Error("Could not check available agent providers. Try again.");
  const available = availability.providers
    .filter((entry) => entry.available)
    .map((entry) => entry.provider)
    .sort();
  if (!available.length)
    throw new Error(
      "No agent provider is available. Set up a provider in Paseo, then retry Refresh.",
    );

  // The installed directory API has no workspace-ID filter. Page metadata and
  // verify exact membership before borrowing any agent's current model.
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await paseo.agents.list({
      filter: { includeArchived: false },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of result.entries) {
      if (
        agent.workspaceId !== workspaceId ||
        agent.archivedAt ||
        agent.labels[workerLabel] ||
        !available.includes(agent.provider)
      )
        continue;
      const fresh = (await paseo.agents.ref(agent.id).refresh())?.agent;
      if (
        !fresh ||
        fresh.workspaceId !== workspaceId ||
        fresh.archivedAt ||
        fresh.labels[workerLabel] ||
        !available.includes(fresh.provider)
      )
        continue;
      const selection = await modelSelection(paseo, fresh.provider, fresh.model);
      return refreshProfileSchema.parse({
        id: `workspace:${fresh.id}`,
        name: `Workspace · ${selection}`,
        provider: selection,
      });
    }
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
    if (page === 19)
      throw new Error(
        "Could not finish looking up workspace agents. Choose a profile in Pins settings or retry.",
      );
  }
  // Empty/new workspaces still work. Use Paseo's catalog without favoring any brand.
  const selection = await modelSelection(paseo, available[0]);
  return refreshProfileSchema.parse({
    id: `automatic:${available[0]}`,
    name: `Automatic · ${selection}`,
    provider: selection,
  });
}
