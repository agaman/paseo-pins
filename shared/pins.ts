import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

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
    notify: z
      .object({
        id: z.string().trim().min(1).max(128),
        reason: z.string().trim().min(1).max(240).optional(),
      })
      .strict()
      .optional()
      .describe(
        "Flag a meaningful update for the user. Reuse the same id when retrying one event; choose a new id for a new event. Routine edits should omit notify. New pins always notify.",
      ),
  })
  .strict();

export const applyPinsSchema = z
  .object({
    upsert: z
      .array(upsertPinSchema)
      .max(100)
      .optional()
      .describe("Links to create or update, in order."),
    remove: z.array(pinKeySchema).max(100).optional().describe("Keys of obsolete links to remove."),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.upsert?.length && !value.remove?.length) {
      context.addIssue({ code: "custom", message: "Provide at least one upsert or removal." });
    }
    const seen = new Set<string>();
    for (const field of ["upsert", "remove"] as const) {
      const keys = field === "upsert" ? value.upsert?.map((pin) => pin.key) : value.remove;
      keys?.forEach((key, index) => {
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: `Key ${key} appears more than once in the batch. Each key may be upserted or removed only once.`,
          });
        }
        seen.add(key);
      });
    }
  });
export type PinBatchInput = z.infer<typeof applyPinsSchema>;

const resourceSchema = upsertPinSchema.omit({ notify: true }).extend({
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
export type Pin = z.infer<typeof pinSchema>;
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

export const pinDocumentSchema = z.union([
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

export function isUnread(pin: Pin): boolean {
  return pin.attention !== null && pin.attention.token !== pin.readAttentionToken;
}

export function pinSnapshot(pins: Pin[]) {
  return { pins, unreadCount: pins.filter(isUnread).length };
}

const snapshotSchema = z.object({
  pins: z.array(pinSchema),
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
