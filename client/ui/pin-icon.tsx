import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import type { PinType } from "../../shared/pins";
import { pinIcons } from "./pin-icons";

export const rowHoverOpacity = 0.12 * 0.72;

export function PinIcon({
  type,
  unread,
  active,
  compact,
  surface,
  activeSurface,
  theme,
  testID,
}: {
  type: PinType;
  unread: boolean;
  active: boolean;
  compact: boolean;
  surface: string;
  activeSurface?: string;
  theme: PluginButtonContentProps["theme"];
  testID: string;
}) {
  return (
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
      <Icon name={pinIcons[type]} size={16} color={theme.colors.foregroundMuted} />
      {unread && (
        <View
          testID={testID}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 11,
            height: 11,
            borderRadius: 6,
            backgroundColor: active && activeSurface ? activeSurface : surface,
          }}
        >
          {active && !activeSurface && (
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
                borderRadius: 6,
                backgroundColor: theme.colors.foreground,
                opacity: rowHoverOpacity,
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
  );
}
