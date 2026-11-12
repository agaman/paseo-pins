import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type PinDocument, pinKeySchema, upsertPinSchema } from "../shared/pins";

const configPin = upsertPinSchema
  .omit({ notify: true })
  .extend({
    type: upsertPinSchema.shape.type.default("link"),
    section: pinKeySchema.nullable().default(null),
    url: upsertPinSchema.shape.url.refine(
      (url) => !/\$\{|%24%7b/i.test(url),
      "Variable substitution is not supported.",
    ),
  })
  .strict();
const configSchema = z
  .object({
    version: z.literal(1),
    pins: z.array(configPin).max(100),
    sections: z
      .array(z.object({ key: pinKeySchema, title: z.string().trim().min(1).max(80) }).strict())
      .max(100)
      .default([]),
  })
  .strict()
  .refine(
    (value) => new Set(value.pins.map((p) => p.key)).size === value.pins.length,
    "Duplicate pin key.",
  )
  .refine(
    (value) => new Set(value.sections.map((s) => s.key)).size === value.sections.length,
    "Duplicate section key.",
  )
  .refine(
    (value) =>
      value.pins.every(
        (p) => p.section === null || value.sections.some((s) => s.key === p.section),
      ),
    "Unknown config section.",
  );
type Config = z.infer<typeof configSchema>;
export type RepoRead =
  | { kind: "ready"; value: Config; digest: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };
const maxBytes = 256 * 1024;

export async function readRepoConfig(directory: string): Promise<RepoRead> {
  try {
    const root = await realpath(directory);
    if (!(await lstat(root)).isDirectory()) throw new Error();
    const folder = path.join(root, ".paseo");
    const file = path.join(folder, "pins.json");
    let parent: Stats;
    let before: Stats;
    try {
      parent = await lstat(folder);
      if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error();
      before = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error();
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let text: string;
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile())
        throw new Error();
      const buffer = Buffer.alloc(maxBytes + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
      }
      const after = await lstat(file);
      const afterParent = await lstat(folder);
      if (
        bytes > maxBytes ||
        after.ino !== opened.ino ||
        after.dev !== opened.dev ||
        after.mtimeMs !== opened.mtimeMs ||
        after.size !== bytes ||
        afterParent.ino !== parent.ino ||
        afterParent.dev !== parent.dev ||
        afterParent.isSymbolicLink() ||
        (await realpath(folder)) !== folder
      )
        throw new Error();
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes));
    } finally {
      await handle.close();
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return { kind: "error", message: ".paseo/pins.json is not valid JSON." };
    }
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join(".") || "configuration";
      // Paths are schema locations; never echo input values or unknown field names.
      const safeField = /^[a-zA-Z0-9.]+$/.test(field) ? field.slice(0, 100) : "configuration";
      return {
        kind: "error",
        message: `Invalid .paseo/pins.json (${safeField}). Check version 1, unique keys, static HTTP(S) URLs and declared sections.`,
      };
    }
    return {
      kind: "ready",
      value: parsed.data,
      digest: createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex"),
    };
  } catch {
    return {
      kind: "error",
      message:
        "Could not safely read .paseo/pins.json. Use a regular UTF-8 file under 256 KiB without symlinks.",
    };
  }
}

export function requireConfigReady(document: PinDocument) {
  if (document.repo.error)
    throw new Error(
      `${document.repo.error} Pin changes are paused until repository configuration is valid.`,
    );
}

export function reconcileRepo(document: PinDocument, read: RepoRead, now: string) {
  const previous = JSON.stringify(document);
  if (read.kind === "error") {
    document.repo.error = read.message;
    document.repo.missingSince = null;
  } else if (
    read.kind === "missing" &&
    document.repo.digest !== null &&
    (document.repo.missingSince === null || Date.parse(now) - document.repo.missingSince < 500)
  ) {
    document.repo.missingSince ??= Date.parse(now);
    document.repo.error =
      "Confirming removal of .paseo/pins.json. The last configuration is still in use.";
  } else {
    const value: Config =
      read.kind === "ready" ? read.value : { version: 1, pins: [], sections: [] };
    const digest = read.kind === "ready" ? read.digest : null;
    if (digest !== document.repo.digest) {
      const keys = new Set(value.pins.map((p) => p.key));
      const sections = new Set(value.sections.map((s) => s.key));
      document.pins = document.pins.filter((p) => p.source !== "repo" || keys.has(p.key));
      document.sections = document.sections.filter(
        (s) => s.source !== "repo" || sections.has(s.key),
      );
      for (const section of value.sections) {
        const index = document.sections.findIndex((s) => s.key === section.key);
        const next = { ...section, source: "repo" as const };
        if (index < 0) document.sections.push(next);
        else document.sections[index] = next;
      }
      for (const entry of value.pins) {
        const index = document.pins.findIndex((p) => p.key === entry.key);
        const old = document.pins[index];
        const unchanged =
          old &&
          old.title === entry.title &&
          old.url === entry.url &&
          old.type === entry.type &&
          old.section === entry.section;
        const pin = {
          ...entry,
          source: "repo" as const,
          instanceId: old?.instanceId ?? randomUUID(),
          kept: old?.kept ?? false,
          createdAt: old?.createdAt ?? now,
          updatedAt: unchanged ? old.updatedAt : now,
          attention: old?.attention ?? null,
          readAttentionToken: old?.readAttentionToken ?? null,
          consumedNotificationIds: old?.consumedNotificationIds ?? [],
        };
        if (index < 0) document.pins.push(pin);
        else document.pins[index] = pin;
      }
      const remaining = new Set(document.sections.map((s) => s.key));
      document.pins = document.pins.map((pin) =>
        pin.section !== null && !remaining.has(pin.section)
          ? { ...pin, section: null, updatedAt: now }
          : pin,
      );
    }
    document.repo = { digest, error: null, missingSince: null };
  }
  return previous !== JSON.stringify(document);
}
