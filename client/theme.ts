import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import type { TextStyle, ViewStyle } from "react-native";
import { Platform } from "react-native";

function channels(hex: string) {
  const value = hex.slice(1);
  const expanded = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
}

function brightness(rgb: number[]) {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function isDarkTheme({ colors }: PluginButtonContentProps["theme"]) {
  return brightness(channels(colors.foreground)) > brightness(channels(colors.surface0));
}

/** Match Paseo's default interaction overlay; this token isn't exposed to plugins. */
export function iconButtonHoverBackground(theme: PluginButtonContentProps["theme"]) {
  return isDarkTheme(theme) ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
}

/**
 * Mirrors Paseo 0.15.4's src/components/ui/tooltip.tsx and src/styles/theme.ts.
 * Geometry is local; public theme colors stay live. Border/shadow tokens aren't exposed.
 */
export function tooltipSurfaceStyle(theme: PluginButtonContentProps["theme"]): ViewStyle {
  const { colors } = theme;
  const dark = isDarkTheme(theme);
  const background = dark ? colors.surface2 : colors.surface0;
  const border = channels(colors.border);
  const surface = channels(background);
  // borderAccent isn't public; soften the supplied border toward this theme's tooltip surface.
  const softBorder = border.map((channel, index) =>
    Math.round(channel * 0.7 + surface[index] * 0.3),
  );
  return {
    backgroundColor: background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `rgb(${softBorder.join(", ")})`,
    // The host uses a neutral black shadow in both modes, with different softness and opacity.
    shadowColor: "rgb(0, 0, 0)",
    shadowOpacity: dark ? 0.2 : 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: dark ? 8 : 16,
    elevation: dark ? 8 : 4,
  };
}

export const tooltipContentStyle = { paddingHorizontal: 8, paddingVertical: 4 };

export const actionTooltipContentStyle: ViewStyle = {
  ...tooltipContentStyle,
  maxWidth: 280,
  // Avoid constraining the label to its button. Native keeps an explicit width because
  // intrinsic CSS sizing isn't part of React Native's public style contract.
  width: Platform.OS === "web" ? ("max-content" as ViewStyle["width"]) : 120,
};

export function tooltipTextStyle({ colors }: PluginButtonContentProps["theme"]): TextStyle {
  return { color: colors.foreground, fontSize: 14, fontWeight: "400" };
}
