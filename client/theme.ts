import type { PluginButtonContentProps } from "@getpaseo/plugin/client";

function channels(hex: string) {
  const value = hex.slice(1);
  const expanded = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
}

function brightness(rgb: number[]) {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

export function readButtonBackground({ colors }: PluginButtonContentProps["theme"]) {
  const foreground = channels(colors.foreground);
  const surface = channels(colors.surface2);
  // Dark themes use their background surface; light themes use the selected 18% tint.
  if (brightness(foreground) > brightness(surface)) return colors.surface0;
  const mixed = surface.map((channel, index) =>
    Math.round(channel * 0.82 + foreground[index] * 0.18),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
