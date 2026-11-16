import type { TurnSummary } from "../../shared/summaries";
import type { TurnIdentity } from "./records";

const prefix = "pins-turn-v1:";

// Provider IDs can restart at zero. The host's start time survives plugin reloads.
export function turnInstance(agentId: string, turnId: string, startedAt: string): TurnIdentity {
  return { agentId, turnId: prefix + JSON.stringify([turnId, startedAt]), startedAt };
}

export function providerTurnId(turnId: string): string {
  return decode(turnId)?.[0] ?? turnId;
}

export function matchesHostTurn(
  summary: TurnSummary,
  active: { turnId: string; startedAt?: string | null } | null | undefined,
): boolean {
  if (!active || providerTurnId(summary.turnId) !== active.turnId) return false;
  // An incomplete snapshot is not evidence that a matching turn has ended.
  if (!active.startedAt || !Number.isFinite(Date.parse(active.startedAt))) return true;
  const instance = decode(summary.turnId);
  if (instance) return instance[1] === active.startedAt;
  // Older summaries recorded hook receipt time, slightly after the host's start.
  // A later host start with the same provider ID belongs to a different turn.
  return Date.parse(summary.startedAt) >= Date.parse(active.startedAt);
}

function decode(turnId: string): [string, string] | undefined {
  if (!turnId.startsWith(prefix)) return;
  try {
    const value: unknown = JSON.parse(turnId.slice(prefix.length));
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string"))
      return value as [string, string];
  } catch {
    /* An older provider ID may happen to start with our prefix. */
  }
}
