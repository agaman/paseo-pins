import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type PinDocument, pinDocumentSchema } from "../shared/pin-document";
import {
  type AcknowledgmentEntries,
  acknowledgmentEntriesSchema,
  pinSnapshot,
} from "../shared/pin-rpc";
import {
  applyPinsSchema,
  type Pin,
  type PinBatchInput,
  type PinInput,
  workspaceIdSchema,
} from "../shared/pins";
import { emptyRepoState } from "../shared/repo-state";
import { summaryEntryUnread, type TurnSummary } from "../shared/summaries";
import { type RepoRead, readRepoConfig, reconcileRepo, requireConfigReady } from "./repo-config";
import { applySections } from "./sections";
import { recordChanges, type TurnIdentity } from "./summaries/records";

type UpsertResult = { status: "created" | "updated" | "unchanged"; pin: Pin; notified: boolean };
type AcknowledgeResult = {
  key: string;
  status: "acknowledged" | "already-read" | "stale" | "absent";
};
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
    private readonly configRoot?: (workspaceId: string) => Promise<string>,
  ) {}

  filePath(workspaceId: string): string {
    workspaceIdSchema.parse(workspaceId);
    const name = createHash("sha256").update(workspaceId).digest("hex");
    return path.join(this.directory, "workspaces", `${name}.json`);
  }

  async list(workspaceId: string): Promise<Pin[]> {
    return (await this.current(workspaceId)).pins;
  }

  async snapshot(workspaceId: string) {
    const { pins, sections, repo } = await this.current(workspaceId);
    return pinSnapshot(pins, sections, repo);
  }

  current(workspaceId: string) {
    if (this.closed) return this.document(workspaceId);
    return this.access(workspaceId, async (document) => document);
  }

  private async access<T>(
    workspaceId: string,
    operation: (document: PinDocument) => Promise<T>,
    signal?: AbortSignal,
  ) {
    // Start lookup concurrently, but reserve queue order immediately so shutdown
    // drains admitted operations and a slower lookup cannot reorder writes.
    workspaceIdSchema.parse(workspaceId);
    const resolvedRoot = this.configRoot
      ? Promise.resolve()
          .then(() => this.configRoot?.(workspaceId))
          .catch(() => undefined)
      : undefined;
    return this.mutate(workspaceId, async () => {
      checkAborted(signal);
      const document = await this.document(workspaceId);
      if (this.configRoot) {
        const root = await resolvedRoot;
        const read: RepoRead = !root
          ? {
              kind: "error",
              message: "Workspace directory is unavailable. Repository pins were preserved.",
            }
          : await readRepoConfig(root);
        checkAborted(signal);
        if (reconcileRepo(document, read, this.now())) await this.save(document, signal);
      }
      return operation(document);
    });
  }

  async document(workspaceId: string): Promise<PinDocument> {
    const file = this.filePath(workspaceId);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          version: 7,
          workspaceId,
          pins: [],
          sections: [],
          summaries: [],
          refresh: null,
          repo: emptyRepoState(),
        };
      throw new Error("Could not read workspace pins.", { cause: error });
    }
    try {
      const document = pinDocumentSchema.parse(JSON.parse(text));
      if (document.workspaceId !== workspaceId) throw new Error("Workspace ID mismatch.");
      return document;
    } catch (error) {
      throw new Error(
        "Stored pins are invalid or from an unsupported version. The file has been preserved.",
        { cause: error },
      );
    }
  }

  upsert(workspaceId: string, input: PinInput, signal?: AbortSignal, turn?: TurnIdentity) {
    return this.apply(workspaceId, { upsert: [input] }, signal, turn).then((result) => ({
      ...result.upsert[0],
      ...pinSnapshot(result.pins, result.sections),
      config: result.config,
    }));
  }

  remove(workspaceId: string, key: string, signal?: AbortSignal, turn?: TurnIdentity) {
    return this.apply(workspaceId, { remove: [key] }, signal, turn).then((result) => ({
      ...result.remove[0],
      ...pinSnapshot(result.pins, result.sections),
      config: result.config,
    }));
  }

  apply(workspaceId: string, input: PinBatchInput, signal?: AbortSignal, turn?: TurnIdentity) {
    const value = applyPinsSchema.parse(input);
    return this.access(
      workspaceId,
      async (document) => {
        checkAborted(signal);
        const { changed, result } = this.applyDocument(document, value, signal, turn);
        if (changed) await this.save(document, signal);
        return result;
      },
      signal,
    );
  }

  // Synchronous callback: no host/network work may hold the workspace mutation queue.
  transaction<T>(
    workspaceId: string,
    operation: (
      document: PinDocument,
      apply: (
        input: PinBatchInput,
        turn?: TurnIdentity,
      ) => ReturnType<PinStore["applyDocument"]>["result"],
    ) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.access(
      workspaceId,
      async (document) => {
        checkAborted(signal);
        const result = operation(
          document,
          (input, turn) =>
            this.applyDocument(document, applyPinsSchema.parse(input), signal, turn).result,
        );
        if (result instanceof Promise) throw new Error("Store transactions must be synchronous.");
        await this.save(document, signal);
        return result;
      },
      signal,
    );
  }

  private applyDocument(
    document: PinDocument,
    value: PinBatchInput,
    signal?: AbortSignal,
    turn?: TurnIdentity,
  ) {
    requireConfigReady(document);
    for (const key of [...(value.upsert ?? []).map((p) => p.key), ...(value.remove ?? [])]) {
      if (document.pins.some((pin) => pin.key === key && pin.source === "repo"))
        throw new Error(
          `Pin ${key} is owned by .paseo/pins.json. Edit the file or use notify for an update message. The batch was not applied.`,
        );
    }
    for (const key of [
      ...(value.sections?.upsert ?? []).map((s) => s.key),
      ...(value.sections?.remove ?? []),
    ]) {
      if (document.sections.some((section) => section.key === key && section.source === "repo"))
        throw new Error(`Section ${key} is owned by .paseo/pins.json. The batch was not applied.`);
    }
    const previousPins = document.pins;
    if (
      turn &&
      document.summaries.some(
        (s) => s.agentId === turn.agentId && s.turnId === turn.turnId && s.endedAt,
      )
    )
      throw new Error("This turn has ended. Retry in a new turn.");
    checkAborted(signal);
    const remove: RemoveResult[] = (value.remove ?? []).map((key) => {
      const pin = previousPins.find((entry) => entry.key === key);
      if (pin?.kept)
        throw new Error(
          `Pin ${key} is kept by the user and cannot be removed. The batch was not applied.`,
        );
      return pin ? { status: "removed", pin } : { status: "absent", key };
    });
    const sectionResults = applySections(document, value);
    const sectionKeys = new Set(document.sections.map((section) => section.key));
    const removedKeys = new Set(value.remove);
    let ungrouped = false;
    const pins = previousPins
      .filter((pin) => !removedKeys.has(pin.key))
      .map((pin) => {
        if (pin.section === null || sectionKeys.has(pin.section)) return pin;
        ungrouped = true;
        return { ...pin, section: null, updatedAt: this.now() };
      });
    const upsert: UpsertResult[] = [];
    for (const entry of value.upsert ?? []) {
      const index = pins.findIndex((pin) => pin.key === entry.key);
      const previous = pins[index];
      const section = entry.section === undefined ? (previous?.section ?? null) : entry.section;
      if (section !== null && !sectionKeys.has(section))
        throw new Error(`Unknown section: ${section}.`);
      const type = entry.type ?? previous?.type ?? "link";
      const notified = Boolean(
        previous && entry.notify && !previous.consumedNotificationIds.includes(entry.notify.id),
      );
      if (
        !notified &&
        previous?.title === entry.title &&
        previous.url === entry.url &&
        previous.type === type &&
        previous.section === section
      ) {
        upsert.push({ status: "unchanged", pin: previous, notified: false });
        continue;
      }
      const timestamp = this.now();
      const pin: Pin = {
        key: entry.key,
        instanceId: previous?.instanceId ?? randomUUID(),
        kept: previous?.kept ?? false,
        source: "agent",
        title: entry.title,
        url: entry.url,
        type,
        section,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        attention: notified
          ? {
              token: randomUUID(),
              notifiedAt: timestamp,
              ...(entry.notify?.reason ? { reason: entry.notify.reason } : {}),
            }
          : (previous?.attention ?? null),
        readAttentionToken: previous?.readAttentionToken ?? null,
        consumedNotificationIds: [
          ...(previous?.consumedNotificationIds ?? []),
          // Consume a creation-time notification ID without notifying: retrying the
          // same create request must not turn it into a new update.
          ...((!previous || notified) && entry.notify ? [entry.notify.id] : []),
        ],
      };
      if (index < 0) pins.push(pin);
      else pins[index] = pin;
      upsert.push({ status: previous ? "updated" : "created", pin, notified });
    }
    const notify: UpsertResult[] = [];
    for (const entry of value.notify ?? []) {
      const index = pins.findIndex(
        (pin) => pin.key === entry.key && pin.instanceId === entry.instanceId,
      );
      const previous = pins[index];
      if (!previous)
        throw new Error(`Pin ${entry.key} was removed or replaced. Read the list again.`);
      if (previous.consumedNotificationIds.includes(entry.id)) {
        notify.push({ status: "unchanged", pin: previous, notified: false });
        continue;
      }
      if (previous.url !== entry.expectedUrl)
        throw new Error(`Pin ${entry.key} has a different destination. Read the list again.`);
      const timestamp = this.now();
      const pin = {
        ...previous,
        updatedAt: timestamp,
        attention: { token: randomUUID(), notifiedAt: timestamp, reason: entry.reason },
        consumedNotificationIds: [...previous.consumedNotificationIds, entry.id],
      };
      pins[index] = pin;
      notify.push({ status: "updated", pin, notified: true });
    }
    const changed =
      notify.some((result) => result.notified) ||
      ungrouped ||
      sectionResults.upsert.some((result) => result.status !== "unchanged") ||
      sectionResults.remove.some((result) => result.status === "removed") ||
      upsert.some((result) => result.status !== "unchanged") ||
      remove.some((result) => result.status === "removed");
    document.pins = pins;
    if (changed && turn) recordChanges(document, turn, [...upsert, ...notify]);
    return {
      changed,
      result: {
        upsert,
        remove,
        notify,
        sectionResults,
        ...pinSnapshot(pins, document.sections, document.repo),
      },
    };
  }

  setKept(
    workspaceId: string,
    key: string,
    instanceId: string,
    kept: boolean,
    signal?: AbortSignal,
  ) {
    return this.access(
      workspaceId,
      async (document) => {
        checkAborted(signal);
        requireConfigReady(document);
        const pin = document.pins.find(
          (entry) => entry.key === key && entry.instanceId === instanceId,
        );
        if (!pin)
          throw new Error("This pin was removed or replaced. Refresh the list and try again.");
        if (pin.source === "repo")
          throw new Error("This pin is owned by .paseo/pins.json and has no Keep toggle.");
        if (pin.kept !== kept) {
          pin.kept = kept;
          await this.save(document, signal);
        }
        return pinSnapshot(document.pins, document.sections, document.repo);
      },
      signal,
    );
  }

  acknowledge(workspaceId: string, entries: AcknowledgmentEntries, signal?: AbortSignal) {
    const values = acknowledgmentEntriesSchema.parse(entries);
    return this.access(
      workspaceId,
      async (document) => {
        checkAborted(signal);
        const pins = document.pins;
        checkAborted(signal);
        const results: AcknowledgeResult[] = values.map(({ key, attentionToken }) => {
          const pin = pins.find((entry) => entry.key === key);
          if (!pin) return { key, status: "absent" };
          if (pin.attention?.token !== attentionToken) return { key, status: "stale" };
          if (pin.readAttentionToken === attentionToken) return { key, status: "already-read" };
          pin.readAttentionToken = attentionToken;
          return { key, status: "acknowledged" };
        });
        if (results.some((result) => result.status === "acknowledged")) {
          await this.save(document, signal);
        }
        return { results, ...pinSnapshot(pins, document.sections, document.repo) };
      },
      signal,
    );
  }

  async summaries(workspaceId: string) {
    return (await this.document(workspaceId)).summaries;
  }

  async summary(workspaceId: string, agentId: string, id: string) {
    const document = await this.document(workspaceId);
    const summary = this.findSummary(document, agentId, id);
    return {
      ...summary,
      unreadCount: summary.entries.filter((entry) => summaryEntryUnread(entry, document.pins))
        .length,
    };
  }

  acknowledgeSummary(workspaceId: string, agentId: string, id: string) {
    return this.mutate(workspaceId, async () => {
      const document = await this.document(workspaceId);
      const summary = this.findSummary(document, agentId, id);
      let acknowledged = 0;
      for (const entry of summary.entries) {
        if (!summaryEntryUnread(entry, document.pins)) continue;
        const pin = document.pins.find((pin) => pin.instanceId === entry.instanceId);
        if (pin) {
          pin.readAttentionToken = entry.attentionToken;
          acknowledged++;
        }
      }
      if (acknowledged) await this.save(document);
      return { acknowledged };
    });
  }

  finalize(
    workspaceId: string,
    agentId: string,
    turnId: string,
    outcome: "completed" | "interrupted",
  ) {
    return this.mutate(workspaceId, async () => {
      const document = await this.document(workspaceId);
      const summary = document.summaries.find((s) => s.agentId === agentId && s.turnId === turnId);
      if (!summary || summary.endedAt) return summary;
      summary.entries = summary.entries.filter((entry) =>
        document.pins.some((pin) => pin.instanceId === entry.instanceId),
      );
      summary.endedAt = this.now();
      summary.outcome = outcome;
      await this.save(document);
      return summary;
    });
  }

  markPublication(
    workspaceId: string,
    id: string,
    state: { recovered?: boolean; published?: boolean },
  ) {
    return this.mutate(workspaceId, async () => {
      const document = await this.document(workspaceId);
      const summary = document.summaries.find((s) => s.id === id);
      if (!summary?.endedAt) throw new Error("Summary has not been finalized.");
      Object.assign(summary, state);
      await this.save(document);
    });
  }

  async workspacesWithSummaries(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(path.join(this.directory, "workspaces"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const ids: string[] = [];
    for (const file of files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file))) {
      try {
        const document = pinDocumentSchema.parse(
          JSON.parse(await readFile(path.join(this.directory, "workspaces", file), "utf8")),
        );
        if (document.summaries.length || document.refresh) ids.push(document.workspaceId);
      } catch (error) {
        console.error("Pins summary recovery skipped an unreadable document", file, error);
      }
    }
    return ids;
  }

  private findSummary(document: PinDocument, agentId: string, id: string): TurnSummary {
    const summary = document.summaries.find((s) => s.id === id && s.agentId === agentId);
    if (!summary?.endedAt || !summary.outcome) throw new Error("Pin summary is unavailable.");
    return summary;
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

  private async save(input: PinDocument, signal?: AbortSignal): Promise<void> {
    const file = this.filePath(input.workspaceId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    const document = pinDocumentSchema.parse(input);
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
