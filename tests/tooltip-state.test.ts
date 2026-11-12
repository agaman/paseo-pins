import assert from "node:assert/strict";
import { test } from "node:test";
import { createTooltipState } from "../client/tooltip-state";

test("pointer exit dismisses even after focus, and a fresh hover can reopen", () => {
  const tips = createTooltipState();
  tips.show("keep", "hover");
  tips.show("keep", "focus");
  tips.hide("keep");
  assert.equal(tips.isOpen("keep"), false);
  tips.show("keep", "hover");
  assert.equal(tips.isOpen("keep"), true);
});
test("only one tooltip owns visibility; stale exit and unmount cannot close its successor", () => {
  const tips = createTooltipState();
  tips.show("first", "focus");
  tips.show("second", "hover");
  assert.equal(tips.isOpen("first"), false);
  tips.hide("first");
  assert.equal(tips.isOpen("second"), true);
});
test("pointer activity dismisses keyboard tips but preserves actively hovered tips", () => {
  const tips = createTooltipState();
  tips.show("keep", "focus");
  tips.pointerActivity();
  assert.equal(tips.isOpen("keep"), false);
  tips.show("keep", "hover");
  tips.pointerActivity();
  assert.equal(tips.isOpen("keep"), true);
});
test("activation and Escape dismiss until a new interaction, and subscriptions clean up", () => {
  const tips = createTooltipState();
  let changes = 0;
  const unsubscribe = tips.subscribe(() => changes++);
  tips.show("keep", "hover");
  tips.hide("keep");
  tips.pointerActivity();
  assert.equal(tips.isOpen("keep"), false);
  tips.show("keep", "focus");
  tips.hide();
  assert.equal(tips.isOpen("keep"), false);
  assert.equal(changes, 4);
  unsubscribe();
  tips.show("other", "hover");
  assert.equal(changes, 4);
});
