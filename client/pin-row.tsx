import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isUnread, type Pin } from "../shared/pins";
import { pinIcons } from "./pin-icons";

export function PinRow({
  pin,
  theme,
  touch,
  compact,
  busy,
  onOpen,
  onRead,
}: {
  pin: Pin;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  compact: boolean;
  busy: boolean;
  onOpen(): void;
  onRead(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState<"link" | "ack" | null>(null);
  const [pressed, setPressed] = useState(false);
  const unread = isUnread(pin);
  const active = hovered || focused !== null || pressed;
  const background = active ? theme.colors.border : "transparent";
  const events = {
    onHoverIn: () => setHovered(true),
    onHoverOut: () => setHovered(false),
    onPressIn: () => setPressed(true),
    onPressOut: () => setPressed(false),
    onBlur: () => setFocused(null),
  };
  return (
    <View
      testID={`pin-row-${pin.key}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 6,
        backgroundColor: background,
        paddingRight: 4,
        minHeight: touch ? 44 : undefined,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Pressable
        {...events}
        accessibilityRole="link"
        accessibilityLabel={`${pin.title}.${unread ? " Unread." : ""} Opens in your browser. ${pin.url}`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onFocus={() => setFocused("link")}
        onPress={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          padding: 4,
          gap: 8,
          borderRadius: 6,
        }}
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
          <Icon name={pinIcons[pin.type]} size={14} color={theme.colors.foregroundMuted} />
          {unread && (
            <View
              testID={`pin-unread-${pin.key}`}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 11,
                height: 11,
                borderRadius: 6,
                backgroundColor: theme.colors.accent,
                borderWidth: 2,
                borderColor: active
                  ? theme.colors.border
                  : compact
                    ? theme.colors.surface2
                    : theme.colors.surface1,
              }}
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: 13,
              lineHeight: 18,
              fontWeight: unread ? "500" : "400",
            }}
          >
            {pin.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 15 }}
          >
            {new URL(pin.url).host}
          </Text>
        </View>
      </Pressable>
      <View style={{ width: touch ? 44 : 28, alignSelf: "stretch", justifyContent: "center" }}>
        {unread && (
          <Pressable
            {...events}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${pin.title} as read`}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onFocus={() => setFocused("ack")}
            onPress={onRead}
            style={{
              minHeight: touch ? 44 : 28,
              alignItems: "center",
              justifyContent: "center",
              opacity: touch || active ? 1 : 0,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: focused === "ack" ? theme.colors.accent : "transparent",
            }}
          >
            <Icon name="Check" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
