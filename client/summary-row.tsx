import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SummaryEntry } from "../shared/pins";
import { PinIcon, rowHoverOpacity } from "./pin-icon";
import { PinMessage } from "./pin-message";

export function SummaryRow({
  entry,
  unread,
  theme,
  compact,
  busy,
  onOpen,
}: {
  entry: SummaryEntry;
  unread: boolean;
  theme: PluginTimelineItemProps["theme"];
  compact: boolean;
  busy: boolean;
  onOpen(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = hovered || focused || pressed;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${entry.title}. ${entry.kind === "added" ? "Added" : "Updated"}.${unread ? " Unread." : ""}${entry.reason ? ` ${entry.reason}` : ""} Opens the captured destination in your browser. ${entry.url}`}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        minHeight: 44,
        paddingHorizontal: 8,
        paddingVertical: 5,
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-start",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: focused ? theme.colors.accent : "transparent",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {active && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            borderRadius: 8,
            backgroundColor: theme.colors.foreground,
            opacity: rowHoverOpacity,
          }}
        />
      )}
      <PinIcon
        type={entry.type}
        unread={unread}
        active={active}
        compact={compact}
        surface={theme.colors.surface0}
        theme={theme}
        testID={`summary-unread-${entry.instanceId}`}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: 14,
            lineHeight: 20,
            fontWeight: unread ? "600" : "400",
          }}
        >
          {entry.title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}
        >
          {entry.kind === "added" ? "Added" : "Updated"} · {new URL(entry.url).host}
        </Text>
        {entry.reason && <PinMessage message={entry.reason} theme={theme} />}
      </View>
    </Pressable>
  );
}
