import { type AgentToolContext, defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { applyPinsSchema, pinKeySchema, upsertPinSchema } from "../shared/pins";
import { pinGuidance } from "./guidance/pins";
import type { PinStore } from "./store";
import type { PinTurns } from "./summaries/turns";

function workspace(context: AgentToolContext): string {
  if (!context.agent.workspaceId) throw new Error("Pins require a Paseo workspace.");
  return context.agent.workspaceId;
}

export function createPinTools(store: PinStore, turns: PinTurns) {
  return [
    defineAgentTool({
      name: "pins_list",
      description: `List the useful links in your current workspace. ${pinGuidance}`,
      input: z.object({}).strict(),
      async execute(_, context) {
        return { structuredContent: await store.snapshot(workspace(context)) };
      },
    }),
    defineAgentTool({
      name: "pins_apply",
      description: `Atomically apply workspace pin and section changes. Use sections.upsert to create/rename and sections.remove to ungroup members without deleting them; at most 100 of each. Section-only batches are allowed. Use notify entries {key, instanceId, expectedUrl, id, reason} for standalone notifications, including configured pins. Provide upsert links and/or remove keys (at most 100 each, or notify entries; at least one operation). Keys must be unique across both lists. Invalid input or a failed write leaves all pins unchanged. Unmentioned pins are preserved. Returns a status for every operation and the resulting pin list, so a follow-up list call is unnecessary. ${pinGuidance}`,
      input: applyPinsSchema,
      async execute(input, context) {
        const workspaceId = workspace(context);
        const result = await turns.run(context, (turn) =>
          store.apply(workspaceId, input, context.signal, turn),
        );
        return { structuredContent: result };
      },
    }),
    defineAgentTool({
      name: "pins_upsert",
      description: `Create or update a workspace link using a stable purpose key. Choose an optional resource type; the plugin maps it to an icon. Users see the title and destination host and click to open the full URL externally. ${pinGuidance}`,
      input: upsertPinSchema,
      async execute(input, context) {
        const workspaceId = workspace(context);
        const result = await turns.run(context, (turn) =>
          store.upsert(workspaceId, input, context.signal, turn),
        );
        return {
          text: `${result.status}: ${result.pin.title} (${result.pin.key})`,
          structuredContent: result,
        };
      },
    }),
    defineAgentTool({
      name: "pins_remove",
      description: `Remove a known obsolete, expired, or superseded workspace link by key. A missing key is already removed. ${pinGuidance}`,
      input: z.object({ key: pinKeySchema }).strict(),
      async execute({ key }, context) {
        const workspaceId = workspace(context);
        const result = await turns.run(context, (turn) =>
          store.remove(workspaceId, key, context.signal, turn),
        );
        return { text: `${result.status}: ${key}`, structuredContent: result };
      },
    }),
  ];
}
