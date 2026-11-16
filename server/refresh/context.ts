import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { RefreshRun } from "../../shared/refresh-state";
import type { PinStore } from "../store";
import { type EvidencePage, evidenceText, indexResources, type ResourceEntry } from "./evidence";
import { activeRun } from "./mutations";

export type Paseo = PluginHandlerContext["paseo"];
export const workerLabel = "pins-refresh";
export const contextInput = z
  .object({
    action: z.enum(["page", "resources", "source"]).optional(),
    agentId: z.string().optional(),
    cursor: z.string().optional(),
    sourceId: z.string().optional(),
    offset: z.number().int().min(0).max(1000000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const action = value.action ?? "page";
    if (
      (action === "source" && (!value.sourceId || value.agentId || value.cursor)) ||
      (action === "resources" && (value.sourceId || value.agentId || value.cursor)) ||
      (action === "page" &&
        (value.sourceId || ((value.offset !== undefined || value.cursor) && !value.agentId)))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Use page with agentId/cursor, resources with offset, or source with sourceId/offset.",
      });
  });
const budget = 80000;
const scanBudget = 2 * 1024 * 1024;
const pageKey = (agentId: string, cursor: string | null) => JSON.stringify([agentId, cursor]);
const bytes = (value: unknown) => JSON.stringify(value).length;

type Cache = {
  runId: string;
  resources: Map<string, ResourceEntry>;
  pages: Set<string>;
  truncated: boolean;
};
type Excerpt = { source: string; role: string; text: string; nextOffset: number | null };

export class RefreshContext {
  private queues = new Map<string, Promise<unknown>>();
  private caches = new Map<string, Cache>();
  constructor(private store: PinStore) {}

  private cache(workspaceId: string, runId: string) {
    let cache = this.caches.get(workspaceId);
    if (!cache || cache.runId !== runId) {
      cache = { runId, resources: new Map(), pages: new Set(), truncated: false };
      this.caches.set(workspaceId, cache);
    }
    return cache;
  }

  async select(workspaceId: string, workerId: string, paseo: Paseo) {
    const conversations: RefreshRun["conversations"] = [];
    let cursor: string | undefined;
    let incomplete = false;
    for (let page = 0; page < 20 && conversations.length < 10; page++) {
      const result = await paseo.agents.list({
        filter: { includeArchived: true },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 100, ...(cursor ? { cursor } : {}) },
      });
      for (const { agent } of result.entries) {
        if (
          agent.workspaceId === workspaceId &&
          agent.id !== workerId &&
          !agent.labels[workerLabel] &&
          !conversations.some((entry) => entry.id === agent.id)
        )
          conversations.push({ id: agent.id, title: agent.title ?? "Conversation", cursors: [] });
        if (conversations.length === 10) break;
      }
      if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
      cursor = result.pageInfo.nextCursor;
      incomplete = page === 19;
    }
    await this.store.transaction(workspaceId, (document) => {
      const run = activeRun(document, workerId);
      run.conversations = conversations;
      run.sources = [];
      run.contextPages = [];
      run.contextScannedCharacters = 0;
      run.contextCharacters = 0;
      run.contextIssues = incomplete
        ? ["Conversation directory scan reached its limit; some recent work may be missing."]
        : [];
      run.contextReady = true;
    });
    this.caches.delete(workspaceId);
    return conversations;
  }

  async prepare(workspaceId: string, workerId: string, paseo: Paseo) {
    const conversations = await this.select(workspaceId, workerId, paseo);
    const run = activeRun(await this.store.document(workspaceId), workerId);
    const mode = run.mode ?? (run.initialCount === 0 ? "discovery" : "maintenance");
    const pages: unknown[] = [];
    const cursors = new Map<string, string | null>(conversations.map((c) => [c.id, null]));
    // Round-robin pages preserve representation across conversations. Maintenance
    // reads one recent page; discovery also indexes three older pages per thread.
    scan: for (let depth = 0; depth < (mode === "discovery" ? 4 : 1); depth++) {
      for (const conversation of conversations) {
        if (!cursors.has(conversation.id)) continue;
        const current = activeRun(await this.store.document(workspaceId), workerId);
        const available = 28000 - current.contextCharacters - 500;
        if (available < 300) break scan;
        try {
          const page = await this.page(
            workspaceId,
            workerId,
            paseo,
            conversation.id,
            cursors.get(conversation.id) ?? null,
            Math.min(available, depth === 0 ? (mode === "discovery" ? 1400 : 2800) : 450),
          );
          pages.push(page);
          if (page.cursor) cursors.set(conversation.id, page.cursor);
          else cursors.delete(conversation.id);
        } catch {
          activeRun(await this.store.document(workspaceId), workerId);
          pages.push({
            conversation: conversation.title,
            error: "History unavailable; retain uncertainty.",
          });
          cursors.delete(conversation.id);
        }
      }
    }
    const resources = await this.resources(workspaceId, workerId, paseo, 0, 9000);
    return {
      mode,
      discoveryVersion: run.discoveryVersion,
      pages,
      resources,
      guidance:
        "Identify important work from conversation content first. The resource index is a retrieval aid, not a priority ranking or exhaustive inventory. Inspect indexed mentions before citing them as evidence.",
    };
  }

  read(workspaceId: string, workerId: string, paseo: Paseo, raw: z.input<typeof contextInput>) {
    const prior = this.queues.get(workspaceId) ?? Promise.resolve();
    const work = prior
      .catch(() => {})
      .then(async () => {
        const input = contextInput.parse(raw);
        if (input.action === "resources")
          return this.resources(workspaceId, workerId, paseo, input.offset ?? 0, 8000);
        if (input.action === "source")
          return this.source(workspaceId, workerId, paseo, input.sourceId ?? "", input.offset ?? 0);
        if (input.agentId)
          return this.page(
            workspaceId,
            workerId,
            paseo,
            input.agentId,
            input.cursor ?? null,
            8000,
            input.offset ?? 0,
          );
        const run = activeRun(await this.store.document(workspaceId), workerId);
        return this.deliver(workspaceId, workerId, {
          mode: run.mode ?? (run.initialCount === 0 ? "discovery" : "maintenance"),
          conversations: run.conversations.map(({ id, title }) => ({ id, title })),
          sources: run.sources
            .filter((s) => s.inspected)
            .slice(-50)
            .map(({ id, title }) => ({ id, title })),
          remainingCharacters: budget - run.contextCharacters,
        });
      });
    this.queues.set(workspaceId, work);
    void work
      .finally(() => {
        if (this.queues.get(workspaceId) === work) this.queues.delete(workspaceId);
      })
      .catch(() => {});
    return work;
  }

  private async deliver<T>(
    workspaceId: string,
    workerId: string,
    result: T,
    inspected: string[] = [],
  ) {
    await this.store.transaction(workspaceId, (document) => {
      const run = activeRun(document, workerId);
      const size = bytes(result);
      if (run.contextCharacters + size > budget)
        throw new Error("Conversation context budget exhausted. Report the unresolved limitation.");
      run.contextCharacters += size;
      for (const source of run.sources) if (inspected.includes(source.id)) source.inspected = true;
    });
    return result;
  }

  private async handle(workspaceId: string, workerId: string, paseo: Paseo, agentId: string) {
    const run = activeRun(await this.store.document(workspaceId), workerId);
    if (!run.conversations.some((c) => c.id === agentId))
      throw new Error("Conversation is outside this refresh.");
    const handle = paseo.agents.ref(agentId);
    const current = await handle.refresh();
    if (!current || current.agent.workspaceId !== workspaceId || current.agent.labels[workerLabel])
      throw new Error("Conversation is no longer available in this workspace.");
    return handle;
  }

  private async fetch(
    workspaceId: string,
    workerId: string,
    paseo: Paseo,
    agentId: string,
    cursor: string | null,
  ) {
    const run = activeRun(await this.store.document(workspaceId), workerId);
    const conversation = run.conversations.find((c) => c.id === agentId);
    if (!conversation || (cursor && !conversation.cursors.includes(cursor)))
      throw new Error("Conversation or cursor is outside this refresh.");
    try {
      const handle = await this.handle(workspaceId, workerId, paseo, agentId);
      const page = await handle.timeline.refetch({
        direction: cursor ? "before" : "tail",
        ...(cursor ? { cursor: JSON.parse(cursor) } : {}),
        limit: 50,
        projection: "canonical",
      });
      if (page.error) throw new Error(page.error);
      activeRun(await this.store.document(workspaceId), workerId);
      return page;
    } catch (error) {
      await this.store.transaction(workspaceId, (document) => {
        const latest = activeRun(document, workerId);
        const issue = `${conversation.title}: history unavailable.`;
        if (!latest.contextIssues.includes(issue)) latest.contextIssues.push(issue);
      });
      throw error;
    }
  }

  private async capture(
    workspaceId: string,
    workerId: string,
    agentId: string,
    cursor: string | null,
    page: EvidencePage,
  ) {
    const run = activeRun(await this.store.document(workspaceId), workerId);
    const conversation = run.conversations.find((c) => c.id === agentId);
    if (!conversation) throw new Error("Conversation is outside this refresh.");
    const cache = this.cache(workspaceId, run.id);
    const key = pageKey(agentId, cursor);
    const epoch = page.startCursor?.epoch ?? page.endCursor?.epoch;
    const records: { source: RefreshRun["sources"][number]; text: string; role: string }[] = [];
    let scanned = 0;
    const previouslyScanned = run.contextPages.some((p) => pageKey(p.agentId, p.cursor) === key);
    const allowance = previouslyScanned
      ? scanBudget
      : Math.max(0, scanBudget - run.contextScannedCharacters);
    for (const entry of [...page.entries].reverse()) {
      const raw = evidenceText(entry);
      if (!raw) continue;
      const text = raw.slice(0, Math.min(128000, allowance - scanned));
      if (!text) {
        cache.truncated = true;
        break;
      }
      scanned += text.length;
      if (text.length < raw.length) cache.truncated = true;
      const id = `${agentId}:${epoch ? `${epoch}:` : ""}${entry.seqStart}-${entry.seqEnd}`;
      const source = {
        id,
        title: conversation.title,
        agentId,
        inspected: false,
        seqStart: entry.seqStart,
        seqEnd: entry.seqEnd,
        epoch,
        cursor,
        timestamp: entry.timestamp,
      };
      records.push({ source, text, role: entry.item.type });
      cache.truncated =
        indexResources(cache.resources, text, {
          sourceId: id,
          conversation: conversation.title,
          timestamp: entry.timestamp ?? null,
        }) || cache.truncated;
    }
    const next = page.hasOlder && page.startCursor ? JSON.stringify(page.startCursor) : null;
    await this.store.transaction(workspaceId, (document) => {
      const latest = activeRun(document, workerId);
      if (!previouslyScanned) {
        if (latest.contextPages.length >= 100) throw new Error("History scan page limit reached.");
        latest.contextPages.push({ agentId, cursor });
        latest.contextScannedCharacters += scanned;
      }
      for (const { source } of records)
        if (!latest.sources.some((s) => s.id === source.id)) latest.sources.push(source);
      const selected = latest.conversations.find((c) => c.id === agentId);
      if (selected && next && !selected.cursors.includes(next)) selected.cursors.push(next);
    });
    cache.pages.add(key);
    return { records, cursor: next, truncated: cache.truncated };
  }

  private async page(
    workspaceId: string,
    workerId: string,
    paseo: Paseo,
    agentId: string,
    cursor: string | null,
    limit: number,
    offset = 0,
  ) {
    const raw = await this.fetch(workspaceId, workerId, paseo, agentId, cursor);
    const page = await this.capture(workspaceId, workerId, agentId, cursor, raw);
    const entries: Excerpt[] = [];
    // Narrative gets first choice; URL-only tool chatter cannot consume all context.
    const ordered = [
      ...page.records.filter((r) => r.role !== "tool_call"),
      ...page.records.filter((r) => r.role === "tool_call"),
    ];
    for (const record of ordered.slice(offset)) {
      const text = record.text.slice(0, Math.min(900, Math.max(80, limit - bytes(entries) - 250)));
      const entry = {
        source: record.source.id,
        role: record.role,
        text,
        nextOffset: text.length < record.text.length ? text.length : null,
      };
      if (bytes([...entries, entry]) > limit) break;
      entries.push(entry);
    }
    const run = activeRun(await this.store.document(workspaceId), workerId);
    return this.deliver(
      workspaceId,
      workerId,
      {
        conversation: run.conversations.find((c) => c.id === agentId)?.title,
        agentId,
        pageCursor: cursor,
        nextEntryOffset: offset + entries.length < ordered.length ? offset + entries.length : null,
        entries,
        cursor: page.cursor,
        omittedMessages:
          entries.length < page.records.length ||
          entries.some((e) => e.nextOffset !== null) ||
          page.truncated,
        remainingCharacters: Math.max(0, budget - run.contextCharacters - bytes(entries)),
      },
      entries.map((e) => e.source),
    );
  }

  private async resources(
    workspaceId: string,
    workerId: string,
    paseo: Paseo,
    offset: number,
    limit: number,
  ) {
    const run = activeRun(await this.store.document(workspaceId), workerId);
    const cache = this.cache(workspaceId, run.id);
    // Only metadata is durable. After reload, reconstruct the bounded index via
    // public timeline reads; raw conversation text is never persisted by Pins.
    for (const page of run.contextPages)
      if (!cache.pages.has(pageKey(page.agentId, page.cursor))) {
        const raw = await this.fetch(workspaceId, workerId, paseo, page.agentId, page.cursor);
        await this.capture(workspaceId, workerId, page.agentId, page.cursor, raw);
      }
    const all = [...cache.resources.values()];
    const resources: ResourceEntry[] = [];
    for (const entry of all.slice(offset)) {
      if (bytes([...resources, entry]) > limit) break;
      resources.push(entry);
    }
    const agents = new Set(
      resources.flatMap((entry) =>
        entry.mentions.map(
          (mention) => run.sources.find((source) => source.id === mention.sourceId)?.agentId,
        ),
      ),
    );
    for (const agentId of agents)
      if (agentId) await this.handle(workspaceId, workerId, paseo, agentId);
    return this.deliver(workspaceId, workerId, {
      resources,
      nextOffset: offset + resources.length < all.length ? offset + resources.length : null,
      truncated: cache.truncated,
      scannedPages: run.contextPages.length,
      scope:
        "Mentions in scanned workspace history only. Repetition is not importance. Read a sourceId near its offset before using it as evidence.",
    });
  }

  private async source(
    workspaceId: string,
    workerId: string,
    paseo: Paseo,
    id: string,
    offset: number,
  ) {
    const run = activeRun(await this.store.document(workspaceId), workerId);
    const source = run.sources.find((s) => s.id === id);
    if (!source || source.seqStart === undefined)
      throw new Error("Source is outside this refresh. Read a registered page first.");
    const handle = await this.handle(workspaceId, workerId, paseo, source.agentId);
    const page = source.epoch
      ? await handle.timeline.refetch({
          direction: "after",
          cursor: { epoch: source.epoch, seq: Math.max(0, source.seqStart - 1) },
          limit: 50,
          projection: "canonical",
        })
      : await this.fetch(workspaceId, workerId, paseo, source.agentId, source.cursor ?? null);
    if (page.error) throw new Error(page.error);
    if (source.epoch && (page.startCursor?.epoch ?? page.endCursor?.epoch) !== source.epoch)
      throw new Error(
        "Source history changed; report the gap instead of using a different message.",
      );
    const entry = page.entries.find(
      (e) => e.seqStart === source.seqStart && e.seqEnd === source.seqEnd,
    );
    const text = entry && evidenceText(entry);
    if (text == null) throw new Error("Source changed or is no longer available; report the gap.");
    const end = Math.min(text.length, offset + 4000);
    return this.deliver(
      workspaceId,
      workerId,
      {
        source: id,
        conversation: source.title,
        timestamp: source.timestamp ?? null,
        offset,
        text: text.slice(offset, end),
        nextOffset: end < text.length ? end : null,
      },
      [id],
    );
  }
}
