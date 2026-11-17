import { z } from "zod";
import { pinRemovalSchema } from "./pin-removal";
import {
  currentPinSchema,
  keptPinSchema,
  ownedPinSchema,
  ownedSectionSchema,
  type Pin,
  type PinSection,
  pinSchema,
  pinSectionSchema,
  resourceSchema,
  v3PinSchema,
  workspaceIdSchema,
} from "./pins";
import { refreshRunSchema } from "./refresh-state";
import { emptyRepoState, repoStateSchema } from "./repo-state";
import { turnSummarySchema } from "./summaries";

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
function hasValidSections(document: { pins: Pin[]; sections: PinSection[] }) {
  return document.pins.every(
    (pin) =>
      pin.section === null ||
      document.sections.some(
        (section) =>
          section.key === pin.section && (pin.source !== "repo" || section.source === "repo"),
      ),
  );
}
function hasRepoMetadata(document: {
  pins: Pin[];
  sections: PinSection[];
  repo: { digest: string | null };
}) {
  return (
    document.repo.digest !== null ||
    (!document.pins.some((pin) => pin.source === "repo") &&
      !document.sections.some((section) => section.source === "repo"))
  );
}
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
  .refine(hasValidSections, "Unknown or non-configured section in stored pins.")
  .refine(hasRepoMetadata, "Configured resources require configuration metadata.");
const v7CompatibleSchema = z.union([
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
const v8DocumentSchema = z
  .object({
    ...v7DocumentSchema.shape,
    version: z.literal(8),
    removals: z
      .array(pinRemovalSchema)
      .max(100)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        "Duplicate removal identity.",
      ),
  })
  .strict()
  .refine(hasValidSections, "Unknown or non-configured section in stored pins.")
  .refine(hasRepoMetadata, "Configured resources require configuration metadata.");
export const pinDocumentSchema = z.union([
  v8DocumentSchema,
  v7CompatibleSchema
    .transform(
      (document): z.input<typeof v8DocumentSchema> => ({ ...document, version: 8, removals: [] }),
    )
    .pipe(v8DocumentSchema),
]);
export type PinDocument = z.infer<typeof pinDocumentSchema>;
