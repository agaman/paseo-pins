import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { pinInstanceIdSchema } from "./pin-identity";
import { type Pin, pinKeySchema, pinTypeSchema, pinUrlSchema, workspaceIdSchema } from "./pins";

const summaryEntrySchema = z
  .object({
    key: pinKeySchema,
    instanceId: pinInstanceIdSchema,
    title: z.string().min(1).max(120),
    url: pinUrlSchema,
    type: pinTypeSchema,
    kind: z.enum(["added", "updated"]),
    attentionToken: z.uuid().nullable(),
    reason: z.string().max(240).optional(),
  })
  .strict();
export type SummaryEntry = z.infer<typeof summaryEntrySchema>;
export const turnSummarySchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    agentId: z.string().min(1),
    turnId: z.string().min(1),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    outcome: z.enum(["completed", "interrupted"]).nullable(),
    recovered: z.boolean(),
    published: z.boolean(),
    entries: z
      .array(summaryEntrySchema)
      .refine(
        (entries) => new Set(entries.map((e) => e.instanceId)).size === entries.length,
        "Duplicate summary entries.",
      ),
  })
  .strict()
  .refine((s) => Boolean(s.endedAt) === Boolean(s.outcome), "Incomplete turn outcome.");
export type TurnSummary = z.infer<typeof turnSummarySchema>;

export function summaryEntryUnread(entry: SummaryEntry, pins: Pin[]) {
  if (entry.attentionToken === null) return false;
  return pins.some(
    (pin) =>
      pin.instanceId === entry.instanceId &&
      pin.attention?.token === entry.attentionToken &&
      pin.readAttentionToken !== entry.attentionToken,
  );
}

export const summaryReferenceSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    summaryId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const summaryRequestSchema = summaryReferenceSchema.extend({ agentId: z.string().min(1) });
export const readSummary = defineRpc({
  name: "pins.summary.read",
  input: summaryRequestSchema.extend({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(25).default(3),
  }),
  output: z.object({
    entries: z.array(summaryEntrySchema),
    total: z.number().int().min(0),
    unreadCount: z.number().int().min(0),
    endedAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    outcome: z.enum(["completed", "interrupted"]),
    recovered: z.boolean(),
  }),
});
export const acknowledgeSummary = defineRpc({
  name: "pins.summary.acknowledge",
  input: summaryRequestSchema,
  output: z.object({ acknowledged: z.number().int().min(0) }),
});
