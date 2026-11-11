import { useEffect, useState } from "react";
import { Platform } from "react-native";

declare const window: {
  matchMedia(query: string): {
    matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
};

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
