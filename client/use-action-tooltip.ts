import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { actionTooltips as tooltips } from "./tooltip-state";

declare const window: {
  addEventListener(
    type: string,
    listener: (event: { key?: string }) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { key?: string }) => void,
    capture?: boolean,
  ): void;
};
let users = 0;
const pointerActivity = () => tooltips.pointerActivity();
const keyDown = (event: { key?: string }) => {
  if (event.key === "Escape") tooltips.hide();
};
function observeInput() {
  if (Platform.OS !== "web") return () => {};
  if (users++ === 0) {
    window.addEventListener("pointermove", pointerActivity, true);
    window.addEventListener("pointerdown", pointerActivity, true);
    window.addEventListener("keydown", keyDown, true);
  }
  return () => {
    if (--users !== 0) return;
    window.removeEventListener("pointermove", pointerActivity, true);
    window.removeEventListener("pointerdown", pointerActivity, true);
    window.removeEventListener("keydown", keyDown, true);
  };
}

export function useActionTooltip(touch: boolean, disabled: boolean) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hovering = useRef(false);
  const open = useSyncExternalStore(
    tooltips.subscribe,
    () => tooltips.isOpen(id),
    () => false,
  );
  useEffect(observeInput, []);
  useEffect(() => () => tooltips.hide(id), [id]);
  useEffect(() => {
    if (disabled) tooltips.hide(id);
  }, [disabled, id]);
  return {
    hovered,
    focused,
    showTooltip: !disabled && open,
    dismiss: () => tooltips.hide(id),
    onHoverIn() {
      hovering.current = true;
      setHovered(true);
      if (!touch && !disabled) tooltips.show(id, "hover");
    },
    onHoverOut() {
      hovering.current = false;
      setHovered(false);
      // Pointer exit wins even if clicking previously left the control focused.
      tooltips.hide(id);
    },
    onFocus() {
      setFocused(true);
      if (!disabled) tooltips.show(id, hovering.current && !touch ? "hover" : "focus");
    },
    onBlur() {
      setFocused(false);
      if (!hovering.current || touch) tooltips.hide(id);
    },
  };
}
