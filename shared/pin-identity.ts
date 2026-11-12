import { z } from "zod";

// Older persisted pins use stable legacy IDs rather than UUIDs.
export const pinInstanceIdSchema = z.string().min(1).max(256);
