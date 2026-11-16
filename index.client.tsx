import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { registerComposerPills } from "./client/menu/composer-pills";
import { PinsButtonIcon } from "./client/menu/pins-button-icon";
import { PinsPopover } from "./client/menu/pins-popover";
import { RefreshSettings } from "./client/refresh/settings";
import { TurnSummary } from "./client/summaries/turn-summary";
import { summaryReferenceSchema } from "./shared/summaries";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "refresh",
    title: "Pins",
    icon: "Pin",
    Component: RefreshSettings,
  });
  // biome-ignore lint/correctness/noComponentHookFactories: Stable contribution component created once, outside rendering.
  const Popover = (props: PluginButtonContentProps) => (
    <PinsPopover
      {...props}
      openSettings={() => {
        props.close();
        client.openSettings("refresh");
      }}
    />
  );
  const removeRenderer = client.addTimelineRenderer({
    kind: "turn-summary",
    version: 1,
    schema: summaryReferenceSchema,
    Component: TurnSummary,
  });
  const removePills = registerComposerPills(client, (onCount) => {
    // biome-ignore lint/correctness/noComponentHookFactories: One stable icon per agent registration, outside rendering.
    const PillIcon = (props: PluginButtonIconProps) => (
      <PinsButtonIcon {...props} onCount={onCount} />
    );
    return {
      title: "Pins",
      label: "Pins",
      icon: PillIcon,
      behavior: { kind: "popover", Content: Popover },
    };
  });

  return () => {
    removeRenderer();
    removeSettings();
    removePills();
  };
}
