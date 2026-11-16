import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { useActionTooltip } from "./use-action-tooltip";

export function MenuAction({
  icon,
  label,
  tooltip,
  theme,
  touch,
  disabled,
  busy,
  expanded,
  showLabel = false,
  onPress,
}: {
  icon: string;
  label: string;
  tooltip: string;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  disabled: boolean;
  busy: boolean;
  expanded?: boolean;
  showLabel?: boolean;
  onPress(): void;
}) {
  const tip = useActionTooltip(touch, disabled);
  const { hovered, focused } = tip;
  const showTooltip = tip.showTooltip && !showLabel;
  const size = touch ? 44 : 24;
  return (
    <View style={{ position: "relative", zIndex: showTooltip ? 1 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy, expanded }}
        disabled={disabled}
        onHoverIn={tip.onHoverIn}
        onHoverOut={tip.onHoverOut}
        onFocus={tip.onFocus}
        onBlur={tip.onBlur}
        onPress={() => {
          tip.dismiss();
          onPress();
        }}
        style={({ pressed }) => ({
          width: showLabel ? undefined : size,
          height: showLabel ? Math.max(size, 32) : size,
          paddingHorizontal: showLabel ? 10 : 0,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: focused ? theme.colors.accent : "transparent",
          backgroundColor:
            !disabled && (hovered || pressed || focused)
              ? theme.colors.border
              : showLabel
                ? theme.colors.surface2
                : "transparent",
          opacity: disabled ? 0.4 : 1,
        })}
      >
        <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
        {showLabel && (
          <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 18 }}>
            {label}
          </Text>
        )}
      </Pressable>
      {showTooltip && (
        <View
          testID="menu-action-tooltip"
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
