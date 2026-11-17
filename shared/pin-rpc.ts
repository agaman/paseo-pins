import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { pinInstanceIdSchema } from "./pin-identity";
import {
  isUnread,
  ownedPinSchema,
  ownedSectionSchema,
  type Pin,
  type PinSection,
  pinKeySchema,
  workspaceIdSchema,
} from "./pins";
import { emptyRepoState, type repoStateSchema } from "./repo-state";

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

export const removePin = defineRpc({
  name: "pins.remove-user",
  input: z
    .object({
      workspaceId: workspaceIdSchema,
      key: pinKeySchema,
      instanceId: pinInstanceIdSchema,
      requestId: z.uuid(),
    })
    .strict(),
  output: snapshotSchema.extend({
    removal: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  }),
});

export const undoPinRemoval = defineRpc({
  name: "pins.undo-removal",
  input: z.object({ workspaceId: workspaceIdSchema, removalId: z.uuid() }).strict(),
  output: snapshotSchema,
});
