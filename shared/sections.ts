import type { Pin, PinSection } from "./pins";

export function groupPins(pins: Pin[], sections: PinSection[]) {
  return [null, ...sections]
    .map((section) => ({
      section,
      pins: pins.filter((pin) => pin.section === (section?.key ?? null)),
    }))
    .filter((group) => group.pins.length > 0);
}
