import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export function MenuAction({
  icon,
  label,
  tooltip,
  theme,
  touch,
  disabled,
  busy,
  onPress,
}: {
  icon: string;
  label: string;
  tooltip: string;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  disabled: boolean;
  busy: boolean;
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showTooltip = (!touch && hovered) || focused;
  const size = touch ? 44 : 24;
  return (
    <View style={{ position: "relative", zIndex: showTooltip ? 1 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={onPress}
        style={({ pressed }) => ({
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: focused ? theme.colors.accent : "transparent",
          backgroundColor:
            !disabled && (hovered || pressed || focused) ? theme.colors.border : "transparent",
          opacity: disabled ? 0.4 : 1,
        })}
      >
        <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
      {showTooltip && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: size + 4,
            right: 0,
            width: 104,
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: 4,
            backgroundColor: theme.colors.foreground,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              lineHeight: 16,
              color: theme.colors.surface0,
              textAlign: "center",
            }}
          >
            {tooltip}
          </Text>
        </View>
      )}
    </View>
  );
}
