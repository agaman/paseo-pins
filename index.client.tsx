import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { PinsHeader } from "./client/pins-header";
import { PinsPopover } from "./client/pins-popover";

export default function contribute(client: PluginClientContext) {
  const registrations = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let release: (() => void) | undefined;
  const remove = (id: string) => {
    registrations.get(id)?.remove();
    registrations.delete(id);
  };
  const register = (workspace: { id: string; archivingAt?: string | null }) => {
    if (lifetime.signal.aborted) return;
    if (workspace.archivingAt) return remove(workspace.id);
    if (registrations.has(workspace.id)) return;
    let lastLabel = "Pins";
    const onCount = (count: number) => {
      const label = count > 0 ? `Pins (${count})` : "Pins";
      if (label === lastLabel) return;
      lastLabel = label;
      registrations.get(workspace.id)?.update({ label, title: label });
    };
    // biome-ignore lint/correctness/noComponentHookFactories: Created once per workspace registration, outside React rendering; identity stays stable across updates.
    const HeaderIcon = (props: PluginButtonIconProps) => (
      <PinsHeader {...props} onCount={onCount} />
    );
    registrations.set(
      workspace.id,
      client.addHeaderButton({
        id: "pins",
        workspaceId: workspace.id,
        button: {
          title: "Pins",
          label: "Pins",
          icon: HeaderIcon,
          behavior: { kind: "popover", Content: PinsPopover },
        },
      }),
    );
  };

  void client.paseo.workspaces
    .list({ subscribe: {} })
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
          const ids = new Set(entries.map((workspace) => workspace.id));
          for (const id of registrations.keys()) if (!ids.has(id)) remove(id);
          entries.forEach(register);
        },
        update: (message) => {
          if (lifetime.signal.aborted || message.type !== "workspace_update") return;
          if (message.payload.kind === "upsert") register(message.payload.workspace);
          else remove(message.payload.id);
        },
        error: (error) => {
          if (!lifetime.signal.aborted) console.error("Pins workspace observation failed", error);
        },
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Pins workspace observation failed", error);
    });

  return () => {
    lifetime.abort();
    release?.();
    for (const id of registrations.keys()) remove(id);
  };
}
