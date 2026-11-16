import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
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
        info="Finds and updates pins using recent workspace conversations, shared with the selected provider."
      >
        <SettingsCard>
          <View>
            <SettingsSelect
              label="Agent profile"
              hint="Applies to all workspaces on this host."
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
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 8,
                padding: 12,
                marginHorizontal: 16,
                marginBottom: 16,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Icon name="Info" size={16} color={theme.colors.foregroundMuted} />
              </View>
              <Text
                style={{
                  flex: 1,
                  color: theme.colors.foregroundMuted,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                Manage profiles in Settings → Agents.
              </Text>
            </View>
          </View>
        </SettingsCard>
      </SettingsSection>
      {settings.status === "ready" &&
        settings.values.profileId &&
        profiles.data &&
        !profiles.data.profiles.some((p) => p.id === settings.values.profileId) && (
          <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>
            Profile unavailable. Choose Automatic or another profile.
          </Text>
        )}
    </View>
  );
}
