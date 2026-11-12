import { createHash } from "node:crypto";
import type { Pin, PinDocument, TurnSummary } from "../shared/pins";

export type TurnIdentity = { agentId: string; turnId: string; startedAt: string };

export function recordChanges(
  document: PinDocument,
  turn: TurnIdentity,
  changes: { pin: Pin; notified: boolean; status: string }[],
) {
  let summary = document.summaries.find(
    (s) => s.agentId === turn.agentId && s.turnId === turn.turnId,
  );
  if (!summary && !changes.some((change) => change.status === "created" || change.notified)) return;
  if (!summary) {
    summary = {
      ...turn,
      id: createHash("sha256")
        .update(JSON.stringify([document.workspaceId, turn.agentId, turn.turnId]))
        .digest("hex"),
      endedAt: null,
      outcome: null,
      recovered: false,
      published: false,
      entries: [],
    } satisfies TurnSummary;
    document.summaries.push(summary);
  }
  for (const { pin, notified, status } of changes) {
    const index = summary.entries.findIndex((entry) => entry.instanceId === pin.instanceId);
    const previous = summary.entries[index];
    if (status !== "created" && !notified && !previous) continue;
    const entry = {
      key: pin.key,
      instanceId: pin.instanceId,
      title: pin.title,
      url: pin.url,
      type: pin.type,
      kind: previous?.kind ?? (status === "created" ? ("added" as const) : ("updated" as const)),
      attentionToken: notified
        ? (pin.attention?.token ?? null)
        : (previous?.attentionToken ?? null),
      reason: notified ? pin.attention?.reason : previous?.reason,
    };
    if (index < 0) summary.entries.push(entry);
    else summary.entries[index] = entry;
  }
}
