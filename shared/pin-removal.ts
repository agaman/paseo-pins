import { z } from "zod";
import { ownedPinSchema } from "./pins";

// Daemon-owned undo receipts. The client holds only the receipt ID and display title.
export const pinRemovalSchema = z
  .object({
    id: z.uuid(),
    pin: ownedPinSchema.refine((pin) => pin.source === "agent", "Cannot remove repository pins."),
    index: z.number().int().nonnegative(),
    restoredInstanceId: z.string().nullable(),
    invalidated: z.boolean(),
  })
  .strict();
export type PinRemoval = z.infer<typeof pinRemovalSchema>;
