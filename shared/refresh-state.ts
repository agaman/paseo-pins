import { z } from "zod";
import { pinInstanceIdSchema } from "./pin-identity";

const text = z.string().trim().min(1);
export const refreshPrioritySchema = z
  .object({
    id: text.max(80),
    work: text.max(240),
    reason: text.max(240),
    sources: z.array(text).max(20),
    outcome: z.enum(["selected", "covered", "no_destination", "unresolved"]),
    pins: z.array(z.object({ key: text, instanceId: pinInstanceIdSchema }).strict()).max(10),
    investigation: z.string().trim().max(500),
  })
  .strict();
export const refreshOutcomeSchema = z.enum([
  "completed",
  "partial",
  "failed",
  "canceled",
  "timed_out",
  "permission_limited",
]);
export const refreshProfileSchema = z.object({
  id: text,
  name: text,
  provider: text,
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.json()).optional(),
});
export const refreshChangeSchema = z.object({
  kind: z.enum(["added", "updated", "removed", "section"]),
  key: text,
  instanceId: z.string().optional(),
  title: text,
  reason: z.string().max(240),
  sources: z.array(z.string()).default([]),
});
export const refreshRunSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    agentId: z.uuid(),
    profile: refreshProfileSchema,
    state: z.enum(["starting", "running", "stopping", "finished"]),
    outcome: refreshOutcomeSchema.nullable(),
    reason: z.string().nullable(),
    startedAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    resultViewedAt: z.iso.datetime().nullable().default(null),
    resultDismissedAt: z.iso.datetime().nullable().default(null),
    cleanupPending: z.boolean(),
    launched: z.boolean(),
    promptSent: z.boolean(),
    initialCount: z.number().int().nonnegative(),
    discoveryVersion: z.union([z.literal(1), z.literal(2)]).default(1),
    mode: z.enum(["discovery", "maintenance"]).optional(),
    priorities: z.array(refreshPrioritySchema).max(12).default([]),
    priorityReportRecorded: z.boolean().default(false),
    noActiveWorkReason: z.string().nullable().default(null),
    scope: z.record(z.string(), z.string()),
    sectionKeys: z.array(z.string()),
    created: z.array(z.string()),
    removedKeys: z.array(z.string()),
    changes: z.array(refreshChangeSchema),
    revision: z.number().int().nonnegative(),
    receipts: z.record(z.string(), z.object({ hash: z.string(), result: z.json() })),
    assessments: z.record(
      z.string(),
      z.object({
        revision: z.string(),
        status: z.enum(["reviewed", "unverified"]),
        reason: z.string(),
      }),
    ),
    conversations: z.array(z.object({ id: text, title: z.string(), cursors: z.array(z.string()) })),
    sources: z.array(
      z.object({
        id: text,
        title: z.string(),
        agentId: z.string(),
        inspected: z.boolean().default(true),
        seqStart: z.number().optional(),
        seqEnd: z.number().optional(),
        epoch: z.string().optional(),
        cursor: z.string().nullable().optional(),
        timestamp: z.string().optional(),
      }),
    ),
    contextPages: z.array(z.object({ agentId: text, cursor: z.string().nullable() })).default([]),
    contextScannedCharacters: z.number().default(0),
    contextCharacters: z.number().int().nonnegative(),
    contextIssues: z.array(z.string()),
    contextReady: z.boolean(),
    discoveryComplete: z.boolean(),
    reviewedSources: z.array(z.string()),
    repositoryGaps: z.array(z.string()),
  })
  .strict();
export type RefreshRun = z.infer<typeof refreshRunSchema>;
export type RefreshOutcome = z.infer<typeof refreshOutcomeSchema>;
