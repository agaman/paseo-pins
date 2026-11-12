import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isUnread, type Pin } from "../shared/pins";
import { PinIcon } from "./pin-icon";
import { PinMessage } from "./pin-message";
import { readButtonBackground } from "./theme";

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
  const message = unread ? pin.attention?.reason : undefined;
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
            backgroundColor: theme.colors.surface2,
          }}
        />
      )}
      <Pressable
        {...events}
        accessibilityRole="link"
        accessibilityLabel={`${pin.title}.${unread ? " Unread." : ""}${message ? ` ${message}` : ""} Opens in your browser. ${pin.url}`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onFocus={() => setFocused("link")}
        onPress={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: message ? "flex-start" : "center",
          paddingVertical: 4,
          paddingHorizontal: 8,
          gap: 8,
          borderRadius: 8,
        }}
      >
        <PinIcon
          type={pin.type}
          unread={unread}
          active={active}
          compact={compact}
          surface={surface}
          activeSurface={theme.colors.surface2}
          theme={theme}
          testID={`pin-unread-${pin.key}`}
        />
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
          {message && <PinMessage message={message} theme={theme} />}
        </View>
      </Pressable>
      <View
        style={{
          width: touch ? 44 : 28,
          alignSelf: "stretch",
          justifyContent: message ? "flex-start" : "center",
          paddingTop: message ? 4 : 0,
        }}
      >
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
