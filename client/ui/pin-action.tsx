import type { PluginButtonContentProps, PluginSerializableIcon } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import {
  actionTooltipContentStyle,
  iconButtonHoverBackground,
  tooltipSurfaceStyle,
  tooltipTextStyle,
} from "../theme";
import { useActionTooltip } from "./use-action-tooltip";

export function PinAction({
  icon,
  label,
  tooltip,
  selected,
  destructive = false,
  visible = true,
  theme,
  touch,
  busy,
  onActive,
  onPress,
}: {
  icon: PluginSerializableIcon;
  label: string;
  tooltip: string;
  selected?: boolean;
  destructive?: boolean;
  visible?: boolean;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  busy: boolean;
  onActive(active: boolean): void;
  onPress(): void;
}) {
  const tip = useActionTooltip(touch, busy);
  const { hovered, focused } = tip;
  const active = hovered || focused;
  const size = touch ? 44 : 28;
  return (
    <View style={{ zIndex: active ? 2 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy, selected }}
        {...(selected === undefined ? {} : { "aria-pressed": selected })}
        aria-disabled={busy}
        // Keep focus/hover stable through a save; gate activation instead of unmounting focus.
        onHoverIn={() => {
          tip.onHoverIn();
          onActive(true);
        }}
        onHoverOut={() => {
          tip.onHoverOut();
          onActive(focused);
        }}
        onFocus={() => {
          tip.onFocus();
          onActive(true);
        }}
        onBlur={() => {
          tip.onBlur();
          onActive(hovered);
        }}
        onPress={() => {
          tip.dismiss();
          if (!busy) onPress();
        }}
        style={({ pressed }) => ({
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          opacity: visible || active ? 1 : 0,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: focused ? theme.colors.accent : "transparent",
          backgroundColor:
            !busy && (active || pressed) ? iconButtonHoverBackground(theme) : "transparent",
        })}
      >
        <Icon
          icon={icon}
          size={14}
          color={
            destructive && active
              ? theme.colors.statusDanger
              : selected
                ? theme.colors.foreground
                : theme.colors.foregroundMuted
          }
        />
      </Pressable>
      {tip.showTooltip && (
        <View
          testID="pin-action-tooltip"
          pointerEvents="none"
          style={{
            position: "absolute",
            // Stay within the row, including at the menu’s bottom edge.
            right: size + 4,
            top: "50%",
            transform: [{ translateY: "-50%" }],
            ...actionTooltipContentStyle,
            ...tooltipSurfaceStyle(theme),
          }}
        >
          <Text
            style={{
              ...tooltipTextStyle(theme),
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
