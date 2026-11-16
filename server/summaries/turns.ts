import type {
  AgentToolContext,
  PluginHandlerContext,
  PluginHookAgent,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import type { TurnSummary } from "../../shared/summaries";
import type { PinStore } from "../store";
import { matchesHostTurn, providerTurnId, turnInstance } from "./identity";
import type { TurnIdentity } from "./records";

type ActiveTurn = { turnId: string | null; captured?: Promise<TurnIdentity> };

type Paseo = PluginHandlerContext["paseo"];
const publicationRetryWindow = 5 * 60 * 1000;

export class PinTurns {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly verified = new Set<string>();
  private readonly ending = new Set<string>();
  private paseo?: Paseo;
  private recovery?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly store: PinStore,
    private readonly now = Date.now,
  ) {}

  connect(paseo: Paseo) {
    if (this.closed || this.paseo) return;
    this.paseo = paseo;
    this.scheduleRecovery();
    this.timer = setInterval(() => this.scheduleRecovery(), 30000);
    this.timer.unref();
  }

  begin(agent: PluginHookAgent, turnId: string | null, paseo: Paseo) {
    if (turnId) this.active.set(agent.id, { turnId });
    else this.active.delete(agent.id);
    this.connect(paseo);
  }

  run<T>(context: AgentToolContext, operation: (turn: TurnIdentity) => Promise<T>): Promise<T> {
    // Capture immediately, before either the per-agent or workspace write queue.
    let known = this.active.get(context.agent.id);
    if (!known) {
      known = { turnId: null };
      this.active.set(context.agent.id, known);
    }
    const slot = known;
    const captured = slot.captured ?? this.capture(context, slot.turnId);
    slot.captured = captured;
    // Failed snapshots are retryable, but a successful identity stays frozen for the turn.
    void captured.catch(() => {
      if (slot.captured === captured) slot.captured = undefined;
    });
    // Attach rejection handling immediately even if another operation holds the queue.
    const ready = captured.then(
      (turn) => ({ turn }),
      (error) => ({ error }),
    );
    const result = this.enqueue(context.agent.id, async () => {
      const resolved = await ready;
      if ("error" in resolved) throw resolved.error;
      return operation(resolved.turn);
    });
    this.connect(context.paseo);
    return result;
  }

  end(agent: PluginHookAgent, turnId: string | null, outcome: PluginTurnOutcome, paseo: Paseo) {
    if (!turnId) {
      this.active.delete(agent.id);
      this.connect(paseo);
      // A nullable event cannot safely identify a turn. The fresh snapshot protects active work.
      return agent.workspaceId
        ? this.recoverAgent(agent.workspaceId, agent.id, paseo)
        : Promise.resolve();
    }
    const active = this.active.get(agent.id);
    const captured =
      active && (active.turnId === null || active.turnId === turnId) ? active.captured : undefined;
    if (active && (active.turnId === null || active.turnId === turnId))
      this.active.delete(agent.id);
    if (!captured) {
      this.connect(paseo);
      // A raw end ID cannot distinguish an abandoned instance from a later turn
      // that made no pin changes. Recover without assigning this event's outcome.
      return agent.workspaceId
        ? this.recoverAgent(agent.workspaceId, agent.id, paseo)
        : Promise.resolve();
    }
    // Recovery may already be waiting on a host snapshot when this event arrives.
    // Reserve the known outcome until its queued finalization has completed.
    const identity = JSON.stringify([agent.id, turnId]);
    this.ending.add(identity);
    const result = this.enqueue(agent.id, async () => {
      try {
        if (!agent.workspaceId) return;
        const turn = await captured.catch(() => undefined);
        const instanceId = turn?.turnId;
        if (!instanceId || providerTurnId(instanceId) !== turnId) return;
        const summary = await this.store.finalize(
          agent.workspaceId,
          agent.id,
          instanceId,
          outcome.kind === "completed" ? "completed" : "interrupted",
        );
        if (summary?.entries.length) await this.publish(agent.workspaceId, summary, paseo);
      } finally {
        this.ending.delete(identity);
      }
    });
    this.connect(paseo);
    return result;
  }

  recoverAgent(workspaceId: string, agentId: string, paseo: Paseo, force = false) {
    return this.enqueue(agentId, async () => {
      const summaries = (await this.store.summaries(workspaceId)).filter(
        (s) => s.agentId === agentId && this.canPublish(s) && (force || !this.verified.has(s.id)),
      );
      if (!summaries.length) return;
      const agent = await paseo.agents.ref(agentId).refresh();
      if (!agent || agent.agent.workspaceId !== workspaceId) return;
      const local = this.active.get(agentId);
      const localIdentity = await local?.captured?.catch(() => undefined);
      for (let summary of summaries) {
        // Host snapshots and earlier summaries may have consumed the retry window.
        if (!this.canPublish(summary)) continue;
        if (!summary.endedAt) {
          // Local lifecycle events can be newer than the awaited host snapshot.
          if (
            localIdentity?.turnId === summary.turnId ||
            this.ending.has(JSON.stringify([agentId, providerTurnId(summary.turnId)])) ||
            matchesHostTurn(summary, agent.agent.activeTurn)
          )
            continue;
          const finalized = await this.store.finalize(
            workspaceId,
            agentId,
            summary.turnId,
            "interrupted",
          );
          if (!finalized) continue;
          summary = finalized;
        }
        if (!summary.entries.length) {
          this.verified.add(summary.id);
          continue;
        }
        await this.publish(workspaceId, summary, paseo);
      }
    });
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.recovery;
    await Promise.allSettled([...this.queues.values()]);
  }

  private async capture(context: AgentToolContext, expected: string | null): Promise<TurnIdentity> {
    const snapshot = await context.paseo.agents.ref(context.agent.id).refresh();
    const active = snapshot?.agent.activeTurn;
    if (
      !active?.turnId ||
      !active.startedAt ||
      !Number.isFinite(Date.parse(active.startedAt)) ||
      snapshot?.agent.workspaceId !== context.agent.workspaceId ||
      (expected !== null && expected !== active.turnId)
    ) {
      throw new Error(
        "Could not identify the active turn and its start time. Retry the pin change in an active agent turn.",
      );
    }
    const identity = turnInstance(context.agent.id, active.turnId, active.startedAt);
    // Keep an existing legacy turn's journal identity when upgrading mid-turn.
    const summaries = await this.store.summaries(snapshot.agent.workspaceId as string);
    const legacy = summaries.filter(
      (s) =>
        s.agentId === context.agent.id && s.turnId === active.turnId && matchesHostTurn(s, active),
    );
    return legacy.length === 1
      ? {
          agentId: context.agent.id,
          turnId: legacy[0].turnId,
          startedAt: legacy[0].startedAt,
        }
      : identity;
  }

  private scheduleRecovery() {
    const paseo = this.paseo;
    if (!paseo || this.closed || this.recovery) return;
    this.recovery = (async () => {
      for (const workspaceId of await this.store.workspacesWithSummaries()) {
        const agents = new Set((await this.store.summaries(workspaceId)).map((s) => s.agentId));
        for (const agentId of agents) {
          if (this.closed) return;
          await this.recoverAgent(workspaceId, agentId, paseo).catch((error) =>
            console.error("Pins summary recovery will retry", error),
          );
        }
      }
    })()
      .catch((error) => console.error("Pins summary recovery will retry", error))
      .finally(() => {
        this.recovery = undefined;
      });
  }

  private canPublish(summary: TurnSummary) {
    // An unknown end time must not turn old abandoned work into a fresh retry.
    return (
      !summary.published &&
      this.now() - Date.parse(summary.endedAt ?? summary.startedAt) <= publicationRetryWindow
    );
  }

  private async publish(workspaceId: string, summary: TurnSummary, paseo: Paseo) {
    if (!this.canPublish(summary)) return;
    const timeline = paseo.agents.ref(summary.agentId).timeline;
    const id = `pins-turn-${summary.id}`;
    // Check every page before a retry. Re-appending an existing row can move/replace history.
    let page = await timeline.refetch({ direction: "tail", limit: 100, projection: "canonical" });
    let found = false;
    for (;;) {
      if (page.error || page.staleCursor || page.gap)
        throw new Error("Timeline history is unavailable; summary publication will retry.");
      found = page.entries.some(
        ({ item }) => item.type === "plugin" && item.pluginId === "paseo-pins" && item.id === id,
      );
      if (found || !page.hasOlder) break;
      if (!page.startCursor || page.staleCursor || page.gap)
        throw new Error("Timeline history is incomplete; summary publication will retry.");
      const previous = page.startCursor;
      page = await timeline.refetch({
        direction: "before",
        cursor: previous,
        limit: 100,
        projection: "canonical",
      });
      if (page.startCursor?.seq === previous.seq || page.staleCursor || page.gap)
        throw new Error("Timeline changed during recovery; publication will retry.");
    }
    if (!found) {
      // Timeline inspection may span several requests; do not append after expiry.
      if (!this.canPublish(summary)) return;
      await timeline.append({
        type: "plugin",
        id,
        kind: "turn-summary",
        version: 1,
        data: { workspaceId, summaryId: summary.id },
      });
    }
    await this.store.markPublication(workspaceId, summary.id, { published: true });
    this.verified.add(summary.id);
  }

  private enqueue<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Pins is shutting down. Retry after reload."));
    const next = (this.queues.get(agentId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.queues.set(agentId, next);
    const finish = () => {
      if (this.queues.get(agentId) === next) this.queues.delete(agentId);
    };
    void next.then(finish, finish);
    return next;
  }
}
