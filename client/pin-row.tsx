import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isUnread, type Pin } from "../shared/pins";
import { pinIcons } from "./pin-icons";
import { readButtonBackground } from "./theme";

// Match the built-in disabled row’s hover without dimming our active text.
const hoverOpacity = 0.12 * 0.72;

export function PinRow({
  pin,
  theme,
  compact,
  native,
  surface,
  touch,
  busy,
  onOpen,
  onRead,
}: {
  pin: Pin;
  theme: PluginButtonContentProps["theme"];
  compact: boolean;
  native: boolean;
  surface: string;
  touch: boolean;
  busy: boolean;
  onOpen(): void;
  onRead(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [ackHovered, setAckHovered] = useState(false);
  const [focused, setFocused] = useState<"link" | "ack" | null>(null);
  const [pressed, setPressed] = useState(false);
  const unread = isUnread(pin);
  const active =
    hovered || focused === "link" || (unread && (ackHovered || focused === "ack")) || pressed;
  useEffect(() => {
    if (unread) return;
    // The acknowledgment button unmounts when read; it may never emit hover-out or blur.
    setAckHovered(false);
    setFocused((target) => (target === "ack" ? null : target));
  }, [unread]);
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
        borderRadius: 8,
        borderWidth: compact ? 1 : 0,
        borderColor: "transparent",
        paddingRight: 4,
        minHeight: touch ? 44 : undefined,
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
            opacity: hoverOpacity,
          }}
        />
      )}
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
          paddingVertical: 4,
          paddingHorizontal: 8,
          gap: 8,
          borderRadius: 8,
        }}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: compact ? 16 : 20,
            height: 24,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={pinIcons[pin.type]} size={16} color={theme.colors.foregroundMuted} />
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
                backgroundColor: surface,
              }}
            >
              {/* Repaint the row behind the dot to mask the icon with a matching halo. */}
              {active && (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    borderRadius: 6,
                    backgroundColor: theme.colors.foreground,
                    opacity: hoverOpacity,
                  }}
                />
              )}
              <View
                style={{
                  position: "absolute",
                  top: 2,
                  left: 2,
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: theme.colors.accent,
                }}
              />
            </View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: native ? 14 : 13,
              lineHeight: 18,
              fontWeight: unread ? "600" : native ? "400" : "500",
            }}
          >
            {pin.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.foregroundMuted,
              fontSize: native ? 12 : 11,
              lineHeight: native ? 16 : 15,
            }}
          >
            {new URL(pin.url).host}
          </Text>
        </View>
      </Pressable>
      <View style={{ width: touch ? 44 : 28, alignSelf: "stretch", justifyContent: "center" }}>
        {unread && (
          <Pressable
            {...events}
            onHoverIn={() => setAckHovered(true)}
            onHoverOut={() => setAckHovered(false)}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${pin.title} as read`}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onFocus={() => setFocused("ack")}
            onPress={onRead}
            style={({ pressed: ackPressed }) => ({
              minHeight: touch ? 44 : 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              borderWidth: 1,
              backgroundColor:
                ackHovered || focused === "ack" || ackPressed
                  ? readButtonBackground(theme, surface)
                  : "transparent",
              borderColor:
                focused === "ack"
                  ? theme.colors.accent
                  : ackHovered || ackPressed
                    ? theme.colors.border
                    : "transparent",
            })}
          >
            <Icon
              name="Check"
              size={14}
              color={
                ackHovered || focused === "ack"
                  ? theme.colors.foreground
                  : theme.colors.foregroundMuted
              }
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}
