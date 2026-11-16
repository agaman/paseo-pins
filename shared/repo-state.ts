import { z } from "zod";

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
