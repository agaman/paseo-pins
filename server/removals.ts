import { randomUUID } from "node:crypto";
import type { PinDocument } from "../shared/pin-document";
import type { PinRemoval } from "../shared/pin-removal";
import { pinSnapshot } from "../shared/pin-rpc";
import { requireConfigReady } from "./repo-config";
import type { PinStore } from "./store";

// Once a key is reused, an old Undo must not resurrect its previous resource later.
export function invalidateRemovalReceipts(document: PinDocument) {
  for (const receipt of document.removals) {
    if (!receipt.restoredInstanceId && document.pins.some((pin) => pin.key === receipt.pin.key))
      receipt.invalidated = true;
  }
}

function removalResult(document: PinDocument, receipt: PinRemoval) {
  return {
    ...pinSnapshot(document.pins, document.sections, document.repo),
    removal:
      receipt.restoredInstanceId || receipt.invalidated
        ? null
        : { id: receipt.id, title: receipt.pin.title },
  };
}

export function removeUserPin(
  store: PinStore,
  workspaceId: string,
  key: string,
  instanceId: string,
  requestId: string,
) {
  return store.transaction(workspaceId, (document) => {
    const previous = document.removals.find((entry) => entry.id === requestId);
    if (previous) {
      if (previous.pin.key !== key || previous.pin.instanceId !== instanceId)
        throw new Error("This removal request was already used for another pin.");
      return removalResult(document, previous);
    }
    requireConfigReady(document);
    const index = document.pins.findIndex(
      (pin) => pin.key === key && pin.instanceId === instanceId,
    );
    if (index < 0)
      throw new Error("This pin was removed or replaced. Refresh the list and try again.");
    const pin = document.pins[index];
    if (pin.source === "repo")
      throw new Error("Repository pins must be removed from .paseo/pins.json.");
    const receipt: PinRemoval = {
      id: requestId,
      pin: structuredClone(pin),
      index,
      restoredInstanceId: null,
      invalidated: false,
    };
    document.pins.splice(index, 1);
    const run = document.refresh;
    if (run && !run.outcome && !run.removedKeys.includes(key)) run.removedKeys.push(key);
    document.removals = [...document.removals.slice(-99), receipt];
    return removalResult(document, receipt);
  });
}

export function undoUserRemoval(store: PinStore, workspaceId: string, removalId: string) {
  return store.transaction(workspaceId, (document) => {
    const receipt = document.removals.find((entry) => entry.id === removalId);
    if (!receipt) throw new Error("Undo is no longer available for this removal.");
    if (!receipt.restoredInstanceId) {
      requireConfigReady(document);
      if (receipt.invalidated || document.pins.some((pin) => pin.key === receipt.pin.key))
        throw new Error("This pin's key has been reused. Undo won't replace the newer pin.");
      // A new lifetime prevents stale menus and refresh workers from editing the restored pin.
      const pin = { ...receipt.pin, instanceId: randomUUID() };
      if (pin.section && !document.sections.some((section) => section.key === pin.section))
        pin.section = null;
      document.pins.splice(Math.min(receipt.index, document.pins.length), 0, pin);
      receipt.restoredInstanceId = pin.instanceId;
    }
    return pinSnapshot(document.pins, document.sections, document.repo);
  });
}
