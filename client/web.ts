import { useEffect, useState } from "react";
import { Platform } from "react-native";

declare const window: {
  innerWidth: number;
  innerHeight: number;
  getComputedStyle(element: LayoutElement): { overflowX: string; overflowY: string };
  matchMedia(query: string): {
    matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
};

// Public browser geometry only: no host selectors or component internals.
type LayoutElement = {
  parentElement: LayoutElement | null;
  clientTop: number;
  clientLeft: number;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};
export type VisibleBounds = { left: number; top: number; right: number; bottom: number };

export function visibleWebBounds(target: unknown, fallback: VisibleBounds): VisibleBounds {
  if (Platform.OS !== "web") return fallback;
  const bounds = {
    left: Math.max(0, fallback.left),
    top: Math.max(0, fallback.top),
    right: Math.min(window.innerWidth, fallback.right),
    bottom: Math.min(window.innerHeight, fallback.bottom),
  };
  let element = target as LayoutElement | null;
  while (element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
      const left = rect.left + element.clientLeft;
      bounds.left = Math.max(bounds.left, left);
      bounds.right = Math.min(bounds.right, left + element.clientWidth);
    }
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
      const top = rect.top + element.clientTop;
      bounds.top = Math.max(bounds.top, top);
      bounds.bottom = Math.min(bounds.bottom, top + element.clientHeight);
    }
    element = element.parentElement;
  }
  return bounds;
}

// Coarse pointers include hybrid laptops: do not require hover to find the action.
export function useTouchControls() {
  const [touch, setTouch] = useState(
    () => Platform.OS !== "web" || window.matchMedia("(any-pointer: coarse)").matches,
  );
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () => setTouch(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return touch;
}
