import type {
  AgentToolContext,
  PluginHandlerContext,
  PluginHookAgent,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import type { TurnSummary } from "../shared/pins";
import type { PinStore } from "./store";
import type { TurnIdentity } from "./summary-records";

type Paseo = PluginHandlerContext["paseo"];

export class PinTurns {
  private readonly active = new Map<string, TurnIdentity>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly verified = new Set<string>();
  private readonly ending = new Set<string>();
  private paseo?: Paseo;
  private recovery?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly store: PinStore) {}

  connect(paseo: Paseo) {
    if (this.closed || this.paseo) return;
    this.paseo = paseo;
    this.scheduleRecovery();
    this.timer = setInterval(() => this.scheduleRecovery(), 30000);
    this.timer.unref();
  }

  begin(agent: PluginHookAgent, turnId: string | null, paseo: Paseo) {
    if (turnId)
      this.active.set(agent.id, { agentId: agent.id, turnId, startedAt: new Date().toISOString() });
    else this.active.delete(agent.id);
    this.connect(paseo);
  }

  run<T>(context: AgentToolContext, operation: (turn: TurnIdentity) => Promise<T>): Promise<T> {
    // Capture immediately, before either the per-agent or workspace write queue.
    const known = this.active.get(context.agent.id);
    const captured = known
      ? Promise.resolve(known)
      : context.paseo.agents
          .ref(context.agent.id)
          .refresh()
          .then((result) => {
            const turn = result?.agent.activeTurn;
            if (!turn?.turnId || result?.agent.workspaceId !== context.agent.workspaceId)
              throw new Error(
                "Could not identify the active turn. Retry the pin change in an active agent turn.",
              );
            return {
              agentId: context.agent.id,
              turnId: turn.turnId,
              startedAt: turn.startedAt ?? new Date().toISOString(),
            };
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
    if (this.active.get(agent.id)?.turnId === turnId) this.active.delete(agent.id);
    // Recovery may already be waiting on a host snapshot when this event arrives.
    // Reserve the known outcome until its queued finalization has completed.
    const identity = JSON.stringify([agent.id, turnId]);
    this.ending.add(identity);
    const result = this.enqueue(agent.id, async () => {
      try {
        if (!agent.workspaceId) return;
        const summary = await this.store.finalize(
          agent.workspaceId,
          agent.id,
          turnId,
          outcome.kind === "completed" ? "completed" : "interrupted",
        );
        if (summary?.entries.length) await this.publish(agent.workspaceId, summary, paseo, false);
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
        (s) => s.agentId === agentId && (force || !this.verified.has(s.id)),
      );
      if (!summaries.length) return;
      const agent = await paseo.agents.ref(agentId).refresh();
      if (!agent || agent.agent.workspaceId !== workspaceId) return;
      for (let summary of summaries) {
        if (!summary.endedAt) {
          // Local lifecycle events can be newer than the awaited host snapshot.
          if (
            this.active.get(agentId)?.turnId === summary.turnId ||
            this.ending.has(JSON.stringify([agentId, summary.turnId])) ||
            agent.agent.activeTurn?.turnId === summary.turnId
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
        await this.publish(workspaceId, summary, paseo, true);
      }
    });
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.recovery;
    await Promise.allSettled([...this.queues.values()]);
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

  private async publish(
    workspaceId: string,
    summary: TurnSummary,
    paseo: Paseo,
    recovery: boolean,
  ) {
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
      if (recovery && !summary.recovered)
        await this.store.markPublication(workspaceId, summary.id, { recovered: true });
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
