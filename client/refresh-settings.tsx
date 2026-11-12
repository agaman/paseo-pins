import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { listRefreshProfiles, refreshSettings } from "../shared/refresh";

export function RefreshSettings({ host, theme }: PluginSurfaceProps) {
  const settings = useSettings(refreshSettings);
  const list = useRpc(listRefreshProfiles);
  const profiles = useQuery({
    queryKey: ["pins-profiles", host.id],
    queryFn: () => list({}),
    retry: false,
  });
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <SettingsSection
        title="Agent refresh"
        info="Refresh uses recent workspace conversations to find useful links and maintain pins. Repository inspection fills specific context gaps. It runs separately for up to five minutes and changes only pins and sections."
      >
        <SettingsSelect
          label="Agent profile"
          hint="Automatic uses the provider and model of the most recently active workspace agent. Other settings use provider defaults. A saved profile overrides this for all workspaces on the host."
          value={settings.status === "ready" ? (settings.values.profileId ?? "") : ""}
          options={[
            { label: "Automatic (workspace model)", value: "" },
            ...(profiles.data?.profiles ?? []).map((p) => ({
              label: `${p.name} · ${p.provider}`,
              value: p.id,
            })),
          ]}
          onValueChange={(value) => {
            if (settings.status === "ready")
              void settings.save({ profileId: value || null }, settings.revision);
          }}
          disabled={settings.status !== "ready" || settings.saving || profiles.isPending}
          error={
            settings.saveError ??
            (settings.status === "error" || settings.status === "invalid"
              ? settings.error
              : null) ??
            (profiles.isError ? "Could not load saved profiles." : null)
          }
        />
      </SettingsSection>
      {profiles.data?.profiles.length === 0 && (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          No saved profile is required. You can refresh pins using Automatic.
        </Text>
      )}
      {settings.status === "ready" &&
        settings.values.profileId &&
        profiles.data &&
        !profiles.data.profiles.some((p) => p.id === settings.values.profileId) && (
          <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>
            The selected profile is no longer available. Choose Automatic or another profile.
          </Text>
        )}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
        Recent conversations are supplied to the selected provider. The worker does not repair
        resources or request additional permissions. New pins start read.
      </Text>
    </View>
  );
}
