import { type RefreshPresentation, refreshView } from "../../shared/refresh";
import type { RefreshRun } from "../../shared/refresh-state";
import type { PinStore } from "../store";

const resultLifetimeMs = 15 * 60 * 1000;

function presentation(run: RefreshRun | null, now: number): RefreshPresentation | null {
  if (!run) return null;
  if (!run.outcome || run.state !== "finished" || run.cleanupPending)
    return { state: "active", autoDismiss: false };
  const autoDismiss = run.outcome === "completed" || run.outcome === "partial";
  const state = run.resultDismissedAt
    ? "dismissed"
    : autoDismiss && run.resultViewedAt
      ? "viewed"
      : autoDismiss && run.endedAt && now - Date.parse(run.endedAt) >= resultLifetimeMs
        ? "expired"
        : "visible";
  return { state, autoDismiss };
}

export class RefreshResults {
  constructor(
    private readonly store: PinStore,
    private readonly now = Date.now,
  ) {}

  async read(workspaceId: string) {
    const { refresh } = await this.store.document(workspaceId);
    return { run: refreshView(refresh), presentation: presentation(refresh, this.now()) };
  }

  acknowledge(workspaceId: string, runId: string, action: "viewed" | "dismissed") {
    return this.store.transaction(workspaceId, (document) => {
      const run = document.refresh;
      const current = presentation(run, this.now());
      // Exact run identity prevents a late response from hiding a new refresh.
      if (run?.id === runId && current && current.state !== "active") {
        const timestamp = new Date(this.now()).toISOString();
        if (action === "dismissed") run.resultDismissedAt ??= timestamp;
        else if (current.autoDismiss) run.resultViewedAt ??= timestamp;
      }
      return { run: refreshView(run), presentation: presentation(run, this.now()) };
    });
  }
}
