import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { pinInstanceIdSchema } from "./pin-identity";
import { refreshRunSchema } from "./refresh-state";

export const workspaceIdSchema = z.string().min(1);
export const pinKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const pinUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        /^https?:\/\//i.test(value) &&
        value === value.trim() &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters that URL parsing would otherwise normalize away.
        !/[\u0000-\u0020\u007f\\]/.test(value) &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an absolute HTTP(S) URL without embedded credentials or whitespace.");

const pinTypeSchema = z.enum(["app", "review", "docs", "example", "artifact", "link"]);
export type PinType = z.infer<typeof pinTypeSchema>;

export const upsertPinSchema = z
  .object({
    key: pinKeySchema.describe(
      "Stable purpose, such as dev-preview or review-pr. Reuse to update.",
    ),
    title: z.string().trim().min(1).max(120),
    url: pinUrlSchema,
    type: pinTypeSchema
      .optional()
      .describe(
        "Resource kind: app for development/staging/deployed apps; review for changes to review; docs for reference/guides; example for demos/code examples; artifact for reports/deliverables; link for anything else. Omit to preserve an existing type, or default a new pin to link. The plugin chooses the icon.",
      ),
    section: pinKeySchema
      .nullable()
      .optional()
      .describe(
        "Section key, or null to ungroup. Omit to preserve an existing assignment. Create sections through pins_apply.",
      ),
    notify: z
      .object({
        id: z.string().trim().min(1).max(128),
        reason: z
          .string()
          .trim()
          .min(1)
          .max(240)
          .describe("Required message explaining what changed and why it matters to the user."),
      })
      .strict()
      .optional()
      .describe(
        "Flag a meaningful update for the user. Reuse the same id when retrying one event; choose a new id for a new event. Routine edits should omit notify. Only updates to existing pins can notify; new pins start read, and notify on creation is ignored (its id is consumed for safe retries).",
      ),
  })
  .strict();

const pinSectionSchema = z
  .object({
    key: pinKeySchema,
    title: z.string().trim().min(1).max(80),
  })
  .strict();
const ownedSectionSchema = pinSectionSchema.extend({ source: z.enum(["agent", "repo"]) });
export type PinSection = z.infer<typeof ownedSectionSchema>;

export const notifyPinSchema = z
  .object({
    key: pinKeySchema,
    instanceId: pinInstanceIdSchema,
    expectedUrl: pinUrlSchema,
    id: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

export const applyPinsSchema = z
  .object({
    notify: z.array(notifyPinSchema).max(100).optional(),
    sections: z
      .object({
        upsert: z.array(pinSectionSchema).max(100).optional(),
        remove: z.array(pinKeySchema).max(100).optional(),
      })
      .strict()
      .optional()
      .describe(
        "Create or rename sections, or remove sections without deleting their pins. Section order is creation order; empty sections are hidden.",
      ),
    upsert: z
      .array(upsertPinSchema)
      .max(100)
      .optional()
      .describe("Links to create or update, in order."),
    remove: z.array(pinKeySchema).max(100).optional().describe("Keys of obsolete links to remove."),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.notify?.length &&
      !value.upsert?.length &&
      !value.remove?.length &&
      !value.sections?.upsert?.length &&
      !value.sections?.remove?.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide at least one pin, section, or notification operation.",
      });
    }
    for (const [prefix, batch] of [
      [[], value],
      [["sections"], value.sections],
    ] as const) {
      const seen = new Set<string>();
      for (const field of ["upsert", "remove", "notify"] as const) {
        const keys =
          field === "notify"
            ? prefix.length
              ? []
              : value.notify?.map((item) => item.key)
            : field === "upsert"
              ? batch?.upsert?.map((item) => item.key)
              : batch?.remove;
        keys?.forEach((key, index) => {
          if (seen.has(key))
            context.addIssue({
              code: "custom",
              path: [...prefix, field, index],
              message: `Key ${key} appears more than once in the batch. Each key may be upserted or removed only once.`,
            });
          seen.add(key);
        });
      }
    }
  });
export type PinBatchInput = z.infer<typeof applyPinsSchema>;

const resourceSchema = upsertPinSchema.omit({ notify: true, section: true }).extend({
  type: pinTypeSchema.default("link"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const pinSchema = resourceSchema.extend({
  attention: z
    .object({
      token: z.uuid(),
      notifiedAt: z.iso.datetime(),
      reason: z.string().trim().min(1).max(240).optional(),
    })
    .strict()
    .nullable(),
  readAttentionToken: z.uuid().nullable(),
  consumedNotificationIds: z
    .array(z.string().trim().min(1).max(128))
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate notification IDs."),
});
const v3PinSchema = pinSchema.extend({ instanceId: pinInstanceIdSchema });
const currentPinSchema = v3PinSchema.extend({ section: pinKeySchema.nullable() });
const keptPinSchema = currentPinSchema.extend({ kept: z.boolean() });
const ownedPinSchema = keptPinSchema.extend({ source: z.enum(["agent", "repo"]) });
export type Pin = z.infer<typeof ownedPinSchema>;

export const summaryEntrySchema = z
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
const turnSummarySchema = z
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
export type PinInput = z.infer<typeof upsertPinSchema>;

const documentSchema = z
  .object({
    version: z.literal(2),
    workspaceId: workspaceIdSchema,
    pins: z
      .array(pinSchema)
      .refine(
        (pins) => new Set(pins.map((pin) => pin.key)).size === pins.length,
        "Duplicate pin keys in stored data.",
      ),
  })
  .strict();

const legacyDocumentSchema = z.union([
  documentSchema,
  documentSchema
    .extend({ version: z.literal(1), pins: z.array(resourceSchema) })
    .transform(
      (document): z.input<typeof documentSchema> => ({
        ...document,
        version: 2 as const,
        pins: document.pins.map((pin) => ({
          ...pin,
          attention: null,
          readAttentionToken: null,
          consumedNotificationIds: [],
        })),
      }),
    )
    .pipe(documentSchema),
]);

const v3DocumentSchema = z
  .object({
    version: z.literal(3),
    workspaceId: workspaceIdSchema,
    pins: z
      .array(v3PinSchema)
      .refine(
        (pins) =>
          new Set(pins.map((p) => p.key)).size === pins.length &&
          new Set(pins.map((p) => p.instanceId)).size === pins.length,
        "Duplicate pin identity.",
      ),
    summaries: z
      .array(turnSummarySchema)
      .refine(
        (items) => new Set(items.map((s) => s.id)).size === items.length,
        "Duplicate summary identity.",
      ),
  })
  .strict();
const previousDocumentSchema = z.union([
  v3DocumentSchema,
  legacyDocumentSchema
    .transform(
      (document): z.input<typeof v3DocumentSchema> => ({
        ...document,
        version: 3 as const,
        pins: document.pins.map((pin) => ({
          ...pin,
          instanceId: `legacy:${pin.key}:${pin.createdAt}`,
        })),
        summaries: [],
      }),
    )
    .pipe(v3DocumentSchema),
]);
const currentDocumentSchema = v3DocumentSchema
  .extend({
    version: z.literal(4),
    sections: z
      .array(pinSectionSchema)
      .refine(
        (sections) => new Set(sections.map((section) => section.key)).size === sections.length,
        "Duplicate section keys.",
      ),
    pins: z
      .array(currentPinSchema)
      .refine(
        (pins) =>
          new Set(pins.map((p) => p.key)).size === pins.length &&
          new Set(pins.map((p) => p.instanceId)).size === pins.length,
        "Duplicate pin identity.",
      ),
  })
  .refine((document) => {
    const keys = new Set(document.sections.map((section) => section.key));
    return document.pins.every((pin) => pin.section === null || keys.has(pin.section));
  }, "Unknown section in stored pins.");
const v4CompatibleSchema = z.union([
  currentDocumentSchema,
  previousDocumentSchema
    .transform(
      (document): z.input<typeof currentDocumentSchema> => ({
        ...document,
        version: 4 as const,
        sections: [],
        pins: document.pins.map((pin) => ({ ...pin, section: null })),
      }),
    )
    .pipe(currentDocumentSchema),
]);
const v5DocumentSchema = z
  .object({
    ...currentDocumentSchema.shape,
    version: z.literal(5),
    refresh: refreshRunSchema.nullable(),
  })
  .strict()
  .refine(
    (document) =>
      document.pins.every(
        (pin) =>
          pin.section === null || document.sections.some((section) => section.key === pin.section),
      ),
    "Unknown section in stored pins.",
  );
const v5CompatibleSchema = z.union([
  v5DocumentSchema,
  v4CompatibleSchema
    .transform(
      (document): z.input<typeof v5DocumentSchema> => ({
        ...document,
        version: 5 as const,
        refresh: null,
      }),
    )
    .pipe(v5DocumentSchema),
]);
const v6DocumentSchema = z
  .object({
    ...v5DocumentSchema.shape,
    version: z.literal(6),
    pins: z
      .array(keptPinSchema)
      .refine(
        (pins) =>
          new Set(pins.map((p) => p.key)).size === pins.length &&
          new Set(pins.map((p) => p.instanceId)).size === pins.length,
        "Duplicate pin identity.",
      ),
  })
  .strict()
  .refine(
    (document) =>
      document.pins.every(
        (pin) =>
          pin.section === null || document.sections.some((section) => section.key === pin.section),
      ),
    "Unknown section in stored pins.",
  );
const v6CompatibleSchema = z.union([
  v6DocumentSchema,
  v5CompatibleSchema
    .transform(
      (document): z.input<typeof v6DocumentSchema> => ({
        ...document,
        version: 6 as const,
        pins: document.pins.map((pin) => ({ ...pin, kept: false })),
      }),
    )
    .pipe(v6DocumentSchema),
]);
export const repoStateSchema = z
  .object({
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    error: z.string().max(400).nullable(),
    missingSince: z.number().nonnegative().nullable(),
  })
  .strict();
export const emptyRepoState = () => ({ digest: null, error: null, missingSince: null });
const v7DocumentSchema = z
  .object({
    ...v6DocumentSchema.shape,
    version: z.literal(7),
    pins: z
      .array(ownedPinSchema)
      .refine(
        (pins) =>
          new Set(pins.map((p) => p.key)).size === pins.length &&
          new Set(pins.map((p) => p.instanceId)).size === pins.length,
        "Duplicate pin identity.",
      ),
    sections: z
      .array(ownedSectionSchema)
      .refine(
        (sections) => new Set(sections.map((s) => s.key)).size === sections.length,
        "Duplicate section key.",
      ),
    repo: repoStateSchema,
  })
  .strict()
  .refine(
    (document) =>
      document.pins.every(
        (pin) =>
          pin.section === null ||
          document.sections.some(
            (section) =>
              section.key === pin.section && (pin.source !== "repo" || section.source === "repo"),
          ),
      ),
    "Unknown or non-configured section in stored pins.",
  )
  .refine(
    (document) =>
      document.repo.digest !== null ||
      (!document.pins.some((pin) => pin.source === "repo") &&
        !document.sections.some((section) => section.source === "repo")),
    "Configured resources require configuration metadata.",
  );
export const pinDocumentSchema = z.union([
  v7DocumentSchema,
  v6CompatibleSchema
    .transform(
      (document): z.input<typeof v7DocumentSchema> => ({
        ...document,
        version: 7,
        pins: document.pins.map((pin) => ({ ...pin, source: "agent" as const })),
        sections: document.sections.map((section) => ({ ...section, source: "agent" as const })),
        repo: emptyRepoState(),
      }),
    )
    .pipe(v7DocumentSchema),
]);
export type PinDocument = z.infer<typeof pinDocumentSchema>;

export function isUnread(pin: Pin): boolean {
  return pin.attention !== null && pin.attention.token !== pin.readAttentionToken;
}

export function pinSnapshot(
  pins: Pin[],
  sections: PinSection[] = [],
  repo = emptyRepoState() as z.infer<typeof repoStateSchema>,
) {
  return {
    pins,
    sections,
    unreadCount: pins.filter(isUnread).length,
    config: { loaded: repo.digest !== null, error: repo.error },
  };
}

const snapshotSchema = z.object({
  sections: z.array(ownedSectionSchema),
  pins: z.array(ownedPinSchema),
  config: z.object({ loaded: z.boolean(), error: z.string().nullable() }),
  unreadCount: z.number().int().nonnegative(),
});

export const acknowledgmentEntriesSchema = z
  .array(
    z
      .object({
        key: pinKeySchema,
        attentionToken: z.uuid(),
      })
      .strict(),
  )
  .min(1)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length,
    "Duplicate acknowledgment keys.",
  );
export type AcknowledgmentEntries = z.infer<typeof acknowledgmentEntriesSchema>;

export const acknowledgePins = defineRpc({
  name: "pins.acknowledge",
  input: z
    .object({ workspaceId: workspaceIdSchema, entries: acknowledgmentEntriesSchema })
    .strict(),
  output: snapshotSchema.extend({
    results: z.array(
      z.object({
        key: pinKeySchema,
        status: z.enum(["acknowledged", "already-read", "stale", "absent"]),
      }),
    ),
  }),
});

export const listPins = defineRpc({
  name: "pins.list",
  input: z.object({ workspaceId: workspaceIdSchema }).strict(),
  output: snapshotSchema,
});

export const setPinKept = defineRpc({
  name: "pins.keep",
  input: z
    .object({
      workspaceId: workspaceIdSchema,
      key: pinKeySchema,
      instanceId: pinInstanceIdSchema,
      kept: z.boolean(),
    })
    .strict(),
  output: snapshotSchema,
});
