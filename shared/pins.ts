import { z } from "zod";
import { pinInstanceIdSchema } from "./pin-identity";

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

export const pinTypeSchema = z.enum(["app", "review", "docs", "example", "artifact", "link"]);
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

export const pinSectionSchema = z
  .object({
    key: pinKeySchema,
    title: z.string().trim().min(1).max(80),
  })
  .strict();
export const ownedSectionSchema = pinSectionSchema.extend({ source: z.enum(["agent", "repo"]) });
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

export const resourceSchema = upsertPinSchema.omit({ notify: true, section: true }).extend({
  type: pinTypeSchema.default("link"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const pinSchema = resourceSchema.extend({
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
export const v3PinSchema = pinSchema.extend({ instanceId: pinInstanceIdSchema });
export const currentPinSchema = v3PinSchema.extend({ section: pinKeySchema.nullable() });
export const keptPinSchema = currentPinSchema.extend({ kept: z.boolean() });
export const ownedPinSchema = keptPinSchema.extend({ source: z.enum(["agent", "repo"]) });
export type Pin = z.infer<typeof ownedPinSchema>;

export type PinInput = z.infer<typeof upsertPinSchema>;

export function isUnread(pin: Pin): boolean {
  return pin.attention !== null && pin.attention.token !== pin.readAttentionToken;
}
