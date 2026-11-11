import { openExternalUrl, type PluginButtonContentProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { listPins } from "../shared/pins";
import { pinIcons } from "./pin-icons";

export function PinsPopover({ workspaceId, theme, layout, close }: PluginButtonContentProps) {
  const list = useRpc(listPins);
  const [opening, setOpening] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["pins", workspaceId],
    queryFn: () => list({ workspaceId }),
    refetchInterval: 2000,
    refetchOnMount: "always",
    retry: false,
  });
  const foreground = { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };
  const error =
    openError ??
    (query.isError
      ? query.data
        ? "Couldn't refresh pins. Showing the last saved list."
        : "Couldn't load pins."
      : null);

  async function open(key: string, url: string) {
    if (opening) return;
    setOpening(key);
    setOpenError(null);
    try {
      // Invoke directly from the press handler, before any await, for browser popup policies.
      await openExternalUrl(url);
      close();
    } catch {
      setOpenError("Couldn't open that link. Please try again.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <View style={{ width: layout.compact ? "100%" : 320, maxWidth: "100%" }}>
      {/* Paseo adds 12px padding plus 4px vertically; leave a 6px desktop inset. */}
      <View
        style={{
          gap: 2,
          marginHorizontal: layout.compact ? 0 : -6,
          marginVertical: layout.compact ? 0 : -10,
        }}
      >
        {query.isPending && <Text style={muted}>Loading pins…</Text>}
        {error && (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={foreground}>
              {error}
            </Text>
            {query.isError && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void query.refetch();
                }}
                style={{ paddingVertical: 8 }}
              >
                <Text style={foreground}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}
        {query.data?.pins.length === 0 && (
          <Text style={muted}>No pins yet. Ask an agent to pin a useful link.</Text>
        )}
        {query.data?.pins.map((pin) => (
          <Pressable
            key={pin.key}
            accessibilityRole="link"
            accessibilityLabel={`${pin.title}. Opens in your browser. ${pin.url}`}
            accessibilityState={{ disabled: opening !== null, busy: opening === pin.key }}
            disabled={opening !== null}
            onHoverIn={() => setHovered(pin.key)}
            onHoverOut={() => setHovered((key) => (key === pin.key ? null : key))}
            onPress={() => {
              void open(pin.key, pin.url);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 4,
              paddingHorizontal: 4,
              gap: 8,
              borderRadius: 6,
              backgroundColor:
                pressed || (opening === null && hovered === pin.key)
                  ? theme.colors.border
                  : "transparent",
              opacity: opening === pin.key ? 0.6 : 1,
            })}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 24,
                height: 24,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={pinIcons[pin.type ?? "link"]}
                size={14}
                color={theme.colors.foregroundMuted}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={foreground}>{pin.title}</Text>
              <Text numberOfLines={1} style={{ ...muted, fontSize: 11, lineHeight: 15 }}>
                {new URL(pin.url).host}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
