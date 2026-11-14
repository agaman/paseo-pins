import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { notifyPinSchema, pinKeySchema, upsertPinSchema, workspaceIdSchema } from "./pins";
import {
  type RefreshRun,
  refreshChangeSchema,
  refreshOutcomeSchema,
  refreshPrioritySchema,
} from "./refresh-state";

export const refreshSettings = defineSettings({
  id: "refresh",
  scope: "host",
  version: 1,
  schema: z.object({ profileId: z.string().nullable().default(null) }),
});
const workspace = z.object({ workspaceId: workspaceIdSchema });
const refreshPresentationSchema = z.object({
  state: z.enum(["active", "visible", "viewed", "dismissed", "expired"]),
  autoDismiss: z.boolean(),
});
export type RefreshPresentation = z.infer<typeof refreshPresentationSchema>;
const viewSchema = z.object({
  id: z.uuid(),
  state: z.enum(["starting", "running", "stopping", "finished"]),
  outcome: refreshOutcomeSchema.nullable(),
  reason: z.string().nullable(),
  profileName: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  cleanupPending: z.boolean(),
  initialCount: z.number(),
  revision: z.number(),
  changes: z.array(refreshChangeSchema),
  unverified: z.number(),
  contextIssues: z.array(z.string()),
  sourceCount: z.number(),
  unverifiedDetails: z.array(z.object({ key: z.string(), reason: z.string() })),
});
export type RefreshView = z.infer<typeof viewSchema>;
export function refreshView(run: RefreshRun | null): RefreshView | null {
  if (!run) return null;
  return {
    id: run.id,
    state: run.state,
    outcome: run.outcome,
    reason: run.reason,
    profileName: run.profile.name,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    cleanupPending: run.cleanupPending,
    initialCount: run.initialCount,
    revision: run.revision,
    changes: run.changes.map((change) => ({
      ...change,
      sources: [
        ...new Set(
          change.sources.map(
            (id) =>
              run.sources.find((source) => source.id === id)?.title ??
              id.replace(/^repository:/, "Repository: "),
          ),
        ),
      ],
    })),
    unverifiedDetails: Object.entries(run.scope).flatMap(([key, id]) =>
      run.removedKeys.includes(key) || run.assessments[id]?.status === "reviewed"
        ? []
        : [{ key, reason: run.assessments[id]?.reason ?? "Not assessed before refresh ended." }],
    ),
    contextIssues: run.contextIssues,
    sourceCount: run.conversations.length,
    unverified: Object.entries(run.scope).filter(
      ([key, id]) => !run.removedKeys.includes(key) && run.assessments[id]?.status !== "reviewed",
    ).length,
  };
}
export function refreshHasError(run: RefreshView): boolean {
  return (
    run.outcome === "failed" || run.outcome === "timed_out" || run.outcome === "permission_limited"
  );
}
export function refreshTitle(run: RefreshView): string {
  const labels = {
    failed: "Refresh failed",
    canceled: "Refresh canceled",
    timed_out: "Refresh timed out",
    permission_limited: "Refresh needs permission",
  };
  if (run.outcome && run.outcome in labels) return labels[run.outcome as keyof typeof labels];
  if (run.state === "stopping") return "Stopping refresh…";
  if (run.state !== "finished")
    return run.initialCount ? "Refreshing pins…" : "Finding useful pins…";
  const counts = (["added", "updated", "removed"] as const)
    .map((kind) => {
      const count = run.changes.filter((change) => change.kind === kind).length;
      return count ? `${count} ${kind}` : null;
    })
    .filter(Boolean);
  if (counts.length) return counts.join(" · ");
  if (run.changes.length) return "Sections reorganized";
  return "No pins changed";
}
export const startRefresh = defineRpc({
  name: "pins.refresh.start",
  input: workspace.extend({ requestId: z.uuid() }),
  output: viewSchema,
});
export const readRefresh = defineRpc({
  name: "pins.refresh.status",
  input: workspace,
  output: z.object({
    run: viewSchema.nullable(),
    configured: z.boolean(),
    presentation: refreshPresentationSchema.nullable(),
  }),
});
export const acknowledgeRefreshResult = defineRpc({
  name: "pins.refresh.acknowledge",
  input: workspace.extend({ runId: z.uuid(), action: z.enum(["viewed", "dismissed"]) }),
  output: z.object({
    run: viewSchema.nullable(),
    presentation: refreshPresentationSchema.nullable(),
  }),
});
export const cancelRefresh = defineRpc({
  name: "pins.refresh.cancel",
  input: workspace.extend({ runId: z.uuid() }),
  output: viewSchema.nullable(),
});
export const listRefreshProfiles = defineRpc({
  name: "pins.refresh.profiles",
  input: z.object({}),
  output: z.object({
    profiles: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string() })),
  }),
});

const reason = z.string().trim().min(1).max(240);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.string().trim().min(1).max(128);
const change = z.object({ key: pinKeySchema, expectedRevision: revision, reason }).strict();
export const refreshApplySchema = z
  .object({
    operationId: operation,
    notify: z
      .array(notifyPinSchema.extend({ expectedRevision: revision }))
      .max(100)
      .optional(),
    upsert: z
      .array(
        upsertPinSchema.extend({
          expectedRevision: revision.nullable(),
          reason,
          sources: z.array(z.string().min(1).max(512)).max(10).default([]),
        }),
      )
      .max(100)
      .optional(),
    remove: z.array(change).max(100).optional(),
    sections: z
      .object({
        upsert: z
          .array(
            z
              .object({
                key: pinKeySchema,
                title: z.string().trim().min(1).max(80),
                expectedRevision: revision.nullable(),
                reason,
              })
              .strict(),
          )
          .max(100)
          .optional(),
        remove: z.array(change).max(100).optional(),
      })
      .strict()
      .optional(),
    sectionRevisions: z.record(pinKeySchema, revision).default({}),
    memberRevisions: z.record(pinKeySchema, revision).default({}),
  })
  .strict();
export type RefreshApply = z.infer<typeof refreshApplySchema>;
const assessment = z.object({ key: pinKeySchema, revision }).strict();
export const refreshReportSchema = z
  .object({
    operationId: operation,
    reviewed: z.array(assessment).max(200),
    unverified: z.array(assessment.extend({ reason })).max(200),
    discovery: z
      .object({
        complete: z.boolean(),
        reviewedSources: z.array(z.string().min(1)).max(1000),
        repositoryGaps: z.array(reason).max(20),
        priorities: z.array(refreshPrioritySchema).max(12).optional(),
        noActiveWorkReason: reason.optional(),
      })
      .strict(),
  })
  .strict();
export type RefreshReport = z.infer<typeof refreshReportSchema>;
