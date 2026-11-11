import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  applyPinsSchema,
  type Pin,
  type PinBatchInput,
  type PinInput,
  pinDocumentSchema,
  workspaceIdSchema,
} from "../shared/pins";

type UpsertResult = { status: "created" | "updated" | "unchanged"; pin: Pin };
type RemoveResult = { status: "removed"; pin: Pin } | { status: "absent"; key: string };

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Pin operation canceled.");
}

export function dataDirectory(): string {
  const override = process.env.PASEO_PINS_DATA_DIR;
  if (override !== undefined) {
    if (!path.isAbsolute(override))
      throw new Error("PASEO_PINS_DATA_DIR must be an absolute path.");
    return override;
  }
  return path.join(homedir(), ".local", "share", "paseo-pins");
}

export class PinStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(
    private readonly directory: string,
    private readonly now = () => new Date().toISOString(),
  ) {}

  filePath(workspaceId: string): string {
    workspaceIdSchema.parse(workspaceId);
    const name = createHash("sha256").update(workspaceId).digest("hex");
    return path.join(this.directory, "workspaces", `${name}.json`);
  }

  async list(workspaceId: string): Promise<Pin[]> {
    const file = this.filePath(workspaceId);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Could not read workspace pins.", { cause: error });
    }
    try {
      const document = pinDocumentSchema.parse(JSON.parse(text));
      if (document.workspaceId !== workspaceId) throw new Error("Workspace ID mismatch.");
      return document.pins;
    } catch (error) {
      throw new Error(
        "Stored pins are invalid or from an unsupported version. The file has been preserved.",
        { cause: error },
      );
    }
  }

  upsert(workspaceId: string, input: PinInput, signal?: AbortSignal) {
    return this.apply(workspaceId, { upsert: [input] }, signal).then((result) => result.upsert[0]);
  }

  remove(workspaceId: string, key: string, signal?: AbortSignal) {
    return this.apply(workspaceId, { remove: [key] }, signal).then((result) => result.remove[0]);
  }

  apply(workspaceId: string, input: PinBatchInput, signal?: AbortSignal) {
    // Validate every operation before entering the workspace's mutation queue.
    const value = applyPinsSchema.parse(input);
    return this.mutate(workspaceId, async () => {
      checkAborted(signal);
      // Read inside the queue so changes from other agents are retained.
      const previousPins = await this.list(workspaceId);
      checkAborted(signal);
      const remove: RemoveResult[] = (value.remove ?? []).map((key) => {
        const pin = previousPins.find((entry) => entry.key === key);
        return pin ? { status: "removed", pin } : { status: "absent", key };
      });
      const removedKeys = new Set(value.remove);
      const pins = previousPins.filter((pin) => !removedKeys.has(pin.key));
      const upsert: UpsertResult[] = [];
      for (const entry of value.upsert ?? []) {
        const index = pins.findIndex((pin) => pin.key === entry.key);
        const previous = pins[index];
        const type = entry.type ?? previous?.type ?? "link";
        if (
          previous?.title === entry.title &&
          previous.url === entry.url &&
          previous.type === type
        ) {
          upsert.push({ status: "unchanged", pin: previous });
          continue;
        }
        const timestamp = this.now();
        const pin: Pin = {
          ...entry,
          type,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (index < 0) pins.push(pin);
        else pins[index] = pin;
        upsert.push({ status: previous ? "updated" : "created", pin });
      }
      const changed =
        upsert.some((result) => result.status !== "unchanged") ||
        remove.some((result) => result.status === "removed");
      // One atomic rename commits the entire batch; no-op batches never write.
      if (changed) await this.save(workspaceId, pins, signal);
      return { upsert, remove, pins };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
  }

  private mutate<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    workspaceIdSchema.parse(workspaceId);
    if (this.closed) return Promise.reject(new Error("Pins is shutting down. Retry after reload."));
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(workspaceId, next);
    // Both branches handle rejection and remove only the final queued operation.
    const finish = () => {
      if (this.queues.get(workspaceId) === next) this.queues.delete(workspaceId);
    };
    void next.then(finish, finish);
    return next;
  }

  private async save(workspaceId: string, pins: Pin[], signal?: AbortSignal): Promise<void> {
    const file = this.filePath(workspaceId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    const document = pinDocumentSchema.parse({ version: 1, workspaceId, pins });
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
        signal,
      });
      checkAborted(signal);
      await rename(temporary, file);
    } catch (error) {
      throw new Error("Could not save workspace pins. The previous list has been preserved.", {
        cause: error,
      });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
