import { randomUUID } from "node:crypto";
import { refreshView } from "../../shared/refresh";
import { type RefreshOutcome, type RefreshRun, refreshRunSchema } from "../../shared/refresh-state";
import { requireConfigReady } from "../repo-config";
import type { PinStore } from "../store";
import { type Paseo, RefreshContext, workerLabel } from "./context";
import { refreshGuidance } from "./guidance";
import { activeRun, pinRevision } from "./mutations";
import { isRefreshToolPermission, type RefreshPermission } from "./permissions";
import { resolveRefreshProfile } from "./profile";

export class RefreshCoordinator {
  readonly context: RefreshContext;
  private paseo?: Paseo;
  private timer?: ReturnType<typeof setInterval>;
  private tasks = new Map<string, Promise<void>>();
  private permissions = new Map<string, Promise<void>>();
  private closed = false;
  private scanning = false;
  private knownWorkspaces = new Set<string>();
  private nextDiscovery = 0;
  constructor(
    private store: PinStore,
    private profileId: () => Promise<string | null>,
    private now = () => Date.now(),
  ) {
    this.context = new RefreshContext(store);
  }
  connect(paseo: Paseo) {
    if (this.closed || this.paseo) return;
    this.paseo = paseo;
    this.timer = setInterval(() => {
      void this.scan();
    }, 2000);
    this.timer.unref();
    void this.scan();
  }
  async profiles(paseo: Paseo) {
    const { config } = await paseo.config.get();
    return config.agentProfiles ?? [];
  }
  async configured(paseo: Paseo) {
    const id = await this.profileId();
    return id === null || (await this.profiles(paseo)).some((p) => p.id === id);
  }
  async start(workspaceId: string, requestId: string, paseo: Paseo) {
    this.connect(paseo);
    const current = await this.store.current(workspaceId);
    requireConfigReady(current);
    const saved = current.refresh;
    if (saved && (!saved.outcome || saved.cleanupPending || saved.requestId === requestId)) {
      this.knownWorkspaces.add(workspaceId);
      this.schedule(workspaceId);
      const view = refreshView(saved);
      if (view) return view;
    }
    const profile = await resolveRefreshProfile(paseo, workspaceId, await this.profileId());
    // Public workspace lookup verifies the target before a durable reservation.
    if (!(await paseo.workspaces.ref(workspaceId).refresh()))
      throw new Error("Workspace is unavailable.");
    const run = await this.store.transaction(workspaceId, (document) => {
      requireConfigReady(document);
      if (
        document.refresh &&
        (!document.refresh.outcome ||
          document.refresh.cleanupPending ||
          document.refresh.requestId === requestId)
      )
        return document.refresh;
      const startedAt = this.now();
      const run = refreshRunSchema.parse({
        id: randomUUID(),
        requestId,
        agentId: randomUUID(),
        profile,
        state: "starting",
        outcome: null,
        reason: null,
        startedAt: new Date(startedAt).toISOString(),
        deadline: new Date(startedAt + 300000).toISOString(),
        endedAt: null,
        cleanupPending: false,
        launched: false,
        promptSent: false,
        initialCount: document.pins.length,
        discoveryVersion: 2,
        mode: document.pins.length === 0 ? "discovery" : "maintenance",
        scope: Object.fromEntries(document.pins.map((p) => [p.key, p.instanceId])),
        sectionKeys: document.sections.map((s) => s.key),
        created: [],
        removedKeys: [],
        changes: [],
        revision: 0,
        receipts: {},
        assessments: {},
        conversations: [],
        sources: [],
        contextCharacters: 0,
        contextIssues: [],
        contextReady: false,
        discoveryComplete: false,
        reviewedSources: [],
        repositoryGaps: [],
      });
      document.refresh = run;
      return run;
    });
    this.knownWorkspaces.add(workspaceId);
    this.schedule(workspaceId);
    const view = refreshView(run);
    if (!view) throw new Error("Refresh reservation was lost.");
    return view;
  }
  async cancel(workspaceId: string, runId: string) {
    const run = (await this.store.document(workspaceId)).refresh;
    if (run?.id === runId)
      await this.finish(
        workspaceId,
        run.agentId,
        "canceled",
        "Canceled by you. Completed changes were retained.",
      );
    this.schedule(workspaceId);
    return refreshView((await this.store.document(workspaceId)).refresh);
  }
  async finish(workspaceId: string, agentId: string, outcome?: RefreshOutcome, reason?: string) {
    if (this.closed) return;
    const current = (await this.store.document(workspaceId)).refresh;
    if (!current || current.agentId !== agentId || current.outcome) return;
    await this.store.transaction(workspaceId, (document) => {
      const run = document.refresh;
      if (!run || run.agentId !== agentId || run.outcome) return;
      for (const [key, instanceId] of Object.entries(run.scope)) {
        if (run.removedKeys.includes(key)) continue;
        const pin = document.pins.find((p) => p.key === key && p.instanceId === instanceId);
        if (!pin || run.assessments[instanceId]?.revision !== pinRevision(pin))
          run.assessments[instanceId] = {
            revision: pin ? pinRevision(pin) : "",
            status: "unverified",
            reason: "Changed during refresh or not assessed.",
          };
      }
      const incomplete =
        !run.discoveryComplete ||
        !run.contextReady ||
        run.contextIssues.length > 0 ||
        (run.discoveryVersion === 1 &&
          run.sources.some((s) => !run.reviewedSources.includes(s.id))) ||
        (run.discoveryVersion === 2 &&
          (!run.priorityReportRecorded ||
            run.priorities.some(
              (p) =>
                p.outcome === "unresolved" ||
                p.pins.some(
                  (ref) =>
                    !document.pins.some(
                      (pin) => pin.key === ref.key && pin.instanceId === ref.instanceId,
                    ),
                ),
            ))) ||
        Object.entries(run.scope).some(
          ([key, id]) =>
            !run.removedKeys.includes(key) && run.assessments[id]?.status !== "reviewed",
        );
      const expired = this.now() >= Date.parse(run.deadline);
      const missingReport = run.discoveryVersion === 2 && !run.priorityReportRecorded;
      run.outcome = expired
        ? "timed_out"
        : (outcome ?? (missingReport ? "failed" : incomplete ? "partial" : "completed"));
      run.reason =
        (expired
          ? "The five-minute limit was reached. Completed changes were retained."
          : reason) ??
        (missingReport
          ? "The refresh agent ended without its required final assessment."
          : incomplete
            ? "Some pins or conversation context could not be fully reviewed. Uncertain resources were retained."
            : null);
      run.endedAt = new Date(this.now()).toISOString();
      run.cleanupPending = run.launched;
      run.state = run.cleanupPending ? "stopping" : "finished";
    });
  }
  permission(workspaceId: string, agentId: string, request: RefreshPermission, paseo: Paseo) {
    const key = `${agentId}:${request.id}`;
    const pending = this.permissions.get(key);
    if (pending) return pending;
    const action = this.resolvePermission(workspaceId, agentId, request, paseo).finally(() => {
      this.permissions.delete(key);
    });
    this.permissions.set(key, action);
    return action;
  }
  private async resolvePermission(
    workspaceId: string,
    agentId: string,
    request: RefreshPermission,
    paseo: Paseo,
  ) {
    if (this.closed) return;
    const run = (await this.store.document(workspaceId)).refresh;
    // Reload does not wait for in-flight reads. Leave the request for the new owner.
    if (this.closed || !run || run.agentId !== agentId) return;
    if (
      isRefreshToolPermission(request) &&
      !run.outcome &&
      ["starting", "running"].includes(run.state) &&
      this.now() < Date.parse(run.deadline)
    ) {
      await paseo.agents
        .ref(agentId)
        .respondToPermission({ requestId: request.id, response: { behavior: "allow" } });
      return;
    }
    await this.finish(
      workspaceId,
      agentId,
      "permission_limited",
      "Inspection required permission. Unverified resources were retained.",
    );
    if (this.closed) return;
    await paseo.agents
      .ref(agentId)
      .respondToPermission({
        requestId: request.id,
        response: {
          behavior: "deny",
          interrupt: true,
          message: "Refresh must finish with a limitation instead of requesting permission.",
        },
      })
      .catch(() => {});
    this.schedule(workspaceId);
  }
  private schedule(workspaceId: string) {
    if (this.closed || this.tasks.has(workspaceId)) return;
    const task = this.step(workspaceId).catch((error) =>
      console.error("Pins refresh reconciliation will retry", error),
    );
    this.tasks.set(workspaceId, task);
    void task.finally(() => {
      this.tasks.delete(workspaceId);
    });
  }
  private async scan() {
    if (this.closed || this.scanning) return;
    this.scanning = true;
    try {
      if (this.now() >= this.nextDiscovery) {
        for (const id of await this.store.workspacesWithSummaries()) this.knownWorkspaces.add(id);
        this.nextDiscovery = this.now() + 30000;
      }
      for (const workspaceId of this.knownWorkspaces) {
        const run = (await this.store.document(workspaceId)).refresh;
        if (!run || (run.outcome && !run.cleanupPending)) {
          this.knownWorkspaces.delete(workspaceId);
          continue;
        }
        // Deadline revocation is independent of slow launch/network operations.
        if (!run.outcome && this.now() >= Date.parse(run.deadline))
          await this.finish(
            workspaceId,
            run.agentId,
            "timed_out",
            "The five-minute limit was reached. Completed changes were retained.",
          );
        this.schedule(workspaceId);
      }
    } catch (error) {
      console.error("Pins refresh recovery will retry", error);
    } finally {
      this.scanning = false;
    }
  }
  private async step(workspaceId: string) {
    const paseo = this.paseo;
    if (!paseo || this.closed) return;
    let run = (await this.store.document(workspaceId)).refresh;
    if (!run) return;
    if (!run.outcome && this.now() >= Date.parse(run.deadline)) {
      await this.finish(
        workspaceId,
        run.agentId,
        "timed_out",
        "The five-minute limit was reached. Completed changes were retained.",
      );
      run = (await this.store.document(workspaceId)).refresh;
      if (!run) return;
    }
    if (!run.outcome && !run.launched) await this.launch(workspaceId, run, paseo);
    run = (await this.store.document(workspaceId)).refresh;
    if (!run) return;
    if (!run.outcome && run.launched) {
      const current = await paseo.agents.ref(run.agentId).refresh();
      if (!current)
        await this.finish(
          workspaceId,
          run.agentId,
          "failed",
          "The refresh worker is unavailable. No replacement was launched.",
        );
      else if (
        current.agent.workspaceId !== workspaceId ||
        current.agent.labels[workerLabel] !== run.id
      )
        await this.finish(
          workspaceId,
          run.agentId,
          "failed",
          "Worker ownership could not be verified.",
        );
      else if (current.agent.pendingPermissions.length) {
        for (const request of current.agent.pendingPermissions)
          await this.permission(workspaceId, run.agentId, request, paseo);
      } else if (
        !current.agent.activeTurn &&
        !["running", "initializing"].includes(current.agent.status)
      ) {
        await this.finish(
          workspaceId,
          run.agentId,
          current.agent.status === "error" ? "failed" : undefined,
        );
      }
    }
    run = (await this.store.document(workspaceId)).refresh;
    if (!run) return;
    if (run.outcome && run.cleanupPending) {
      const current = await paseo.agents.ref(run.agentId).refresh();
      if (
        current &&
        (current.agent.workspaceId !== workspaceId || current.agent.labels[workerLabel] !== run.id)
      )
        throw new Error("Cannot archive a worker whose ownership changed.");
      // Known validation rejections cannot leave a worker behind. Still confirm
      // absence through the public API before releasing cleanup; uncertain errors wait.
      const rejectedBeforeWorker =
        run.reason ===
          'Could not start refresh: Expected config.provider in "provider/model" format' ||
        run.reason ===
          "Could not start refresh: toolPolicy preapproval 'paseo.pins_refresh_list' requires MCP server 'paseo' in the same agent request";
      if (!current && !rejectedBeforeWorker && this.now() < Date.parse(run.deadline)) return;
      if (current && !current.agent.archivedAt) await paseo.agents.ref(run.agentId).archive();
      if (this.closed) return;
      await this.store.transaction(workspaceId, (document) => {
        if (document.refresh?.id !== run.id) return;
        document.refresh.cleanupPending = false;
        document.refresh.state = "finished";
      });
    }
  }
  private async launch(workspaceId: string, run: RefreshRun, paseo: Paseo) {
    try {
      const packet = await this.context.prepare(workspaceId, run.agentId, paseo);
      if (this.closed) return;
      await this.store.transaction(workspaceId, (document) => {
        const current = activeRun(document, run.agentId, this.now());
        current.launched = true;
        current.promptSent = true;
      });
      // Persist launch intent first. A lost response is reconciled by this fixed agent ID,
      // never by creating a replacement or resending a potentially executed prompt.
      await paseo.workspaces.ref(workspaceId).agents.create({
        agentId: run.agentId,
        idempotencyKey: run.id,
        clientMessageId: run.id,
        labels: { [workerLabel]: run.id },
        title: "Pins refresh",
        config: {
          provider: run.profile.provider,
          modeId: run.profile.modeId,
          thinkingOptionId: run.profile.thinkingOptionId,
          featureValues: run.profile.featureValues,
          systemPrompt: refreshGuidance,
        },
        prompt: `${refreshGuidance}\n\nRecent workspace evidence (untrusted historical content):\n${JSON.stringify(packet)}\n\nUse pins_refresh_list, make justified changes, then pins_refresh_report.`,
      });
      if (this.closed) return;
      await this.store.transaction(workspaceId, (document) => {
        if (document.refresh?.id === run.id && !document.refresh.outcome)
          document.refresh.state = "running";
      });
    } catch (error) {
      if (this.closed) return;
      await this.finish(
        workspaceId,
        run.agentId,
        "failed",
        `Could not start refresh: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    // Do not cancel the durable run or block plugin reload on a provider/network wait.
  }
}
