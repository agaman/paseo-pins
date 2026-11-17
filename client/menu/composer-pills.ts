import type {
  PluginButton,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";

type Agent = Awaited<
  ReturnType<PluginClientContext["paseo"]["agents"]["list"]>
>["entries"][number]["agent"];

/** Follow the public agent directory without recreating open popovers on status updates. */
export function registerComposerPills(
  client: PluginClientContext,
  makeButton: (onCount: (count: number) => void) => PluginButton,
) {
  const registrations = new Map<
    string,
    { workspaceId: string; registration: PluginButtonRegistration }
  >();
  const lifetime = new AbortController();
  let release: (() => void) | undefined;
  const remove = (id: string) => {
    registrations.get(id)?.registration.remove();
    registrations.delete(id);
  };
  const register = (agent: Pick<Agent, "id" | "workspaceId" | "archivedAt">) => {
    if (lifetime.signal.aborted) return;
    const { workspaceId } = agent;
    if (!workspaceId || agent.archivedAt) return remove(agent.id);
    const existing = registrations.get(agent.id);
    if (existing?.workspaceId === workspaceId) return;
    remove(agent.id);
    let lastLabel = "Pins";
    let registration: PluginButtonRegistration | undefined;
    const onCount = (count: number) => {
      if (lifetime.signal.aborted || registrations.get(agent.id)?.registration !== registration)
        return;
      const label = count > 0 ? `Pins (${count})` : "Pins";
      if (label === lastLabel) return;
      lastLabel = label;
      registration?.update({ label, title: label });
    };
    registration = client.addComposerPill({
      id: "pins",
      workspaceId,
      agentId: agent.id,
      button: makeButton(onCount),
    });
    registrations.set(agent.id, { workspaceId, registration });
  };

  // A fresh sync snapshot covers the entire active directory, beyond the normal 200-row page.
  void client.paseo.agents
    .list({ scope: "active", sync: {}, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return;
      }
      release = () => {
        void subscription.release();
      };
      subscription.subscribe({
        snapshot: ({ entries }) => {
          if (lifetime.signal.aborted) return;
          const ids = new Set(entries.map(({ agent }) => agent.id));
          for (const id of registrations.keys()) if (!ids.has(id)) remove(id);
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (lifetime.signal.aborted || message.type !== "agent_update") return;
          if (message.payload.kind === "upsert") register(message.payload.agent);
          else remove(message.payload.agentId);
        },
        error: (error) => {
          if (!lifetime.signal.aborted) console.error("Pins agent observation failed", error);
        },
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Pins agent observation failed", error);
    });

  return () => {
    lifetime.abort();
    release?.();
    for (const id of registrations.keys()) remove(id);
  };
}
