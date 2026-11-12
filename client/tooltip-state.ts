// Shared ownership keeps focused and hovered controls from showing competing tips.
export function createTooltipState() {
  let owner: string | null = null;
  let source: "hover" | "focus" = "hover";
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const hide = (id?: string) => {
    if (owner === null || (id !== undefined && owner !== id)) return;
    owner = null;
    publish();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: (id: string) => owner === id,
    show(id: string, origin: "hover" | "focus") {
      owner = id;
      source = origin;
      publish();
    },
    hide,
    pointerActivity() {
      if (source === "focus") hide();
    },
  };
}
