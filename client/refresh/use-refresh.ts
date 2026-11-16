import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  acknowledgeRefreshResult,
  cancelRefresh,
  readRefresh,
  startRefresh,
} from "../../shared/refresh";

// Request identity only, not a security token. Works in native and web clients.
function requestId() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (Number(digit) ^ (Math.floor(Math.random() * 16) >> (Number(digit) / 4))).toString(16),
  );
}
export function useRefresh(hostId: string, workspaceId: string) {
  const read = useRpc(readRefresh);
  const start = useRpc(startRefresh);
  const cancel = useRpc(cancelRefresh);
  const acknowledge = useRpc(acknowledgeRefreshResult);
  const cache = useQueryClient();
  const pending = useRef(false);
  const attempt = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const queryKey = ["pins-refresh", hostId, workspaceId];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await read({ workspaceId });
      if (signal.aborted) throw new Error("Refresh status fetch canceled.");
      return result;
    },
    refetchInterval: 2000,
    refetchOnMount: "always",
    // Result visibility is daemon-owned; reopening must not flash a cached result.
    gcTime: 0,
    retry: false,
  });
  const acknowledgeResult = useCallback(
    async (runId: string, action: "viewed" | "dismissed") => {
      const key = ["pins-refresh", hostId, workspaceId];
      try {
        await cache.cancelQueries({ queryKey: key });
        await acknowledge({ workspaceId, runId, action });
        // Fetch fresh status instead of allowing an older acknowledgment response
        // to replace a newer run or another device's dismissal in the cache.
        await cache.cancelQueries({ queryKey: key });
        await cache.invalidateQueries({ queryKey: key });
        setResultError(null);
        return true;
      } catch {
        if (action === "dismissed")
          setResultError("Couldn't save refresh-result dismissal. Please try again.");
        return false;
      }
    },
    [acknowledge, cache, hostId, workspaceId],
  );
  async function act(runId?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setResultError(null);
    try {
      if (runId) await cancel({ workspaceId, runId });
      else {
        attempt.current ??= requestId();
        await start({ workspaceId, requestId: attempt.current });
        attempt.current = null;
      }
      await cache.invalidateQueries({ queryKey });
      void cache.invalidateQueries({ queryKey: ["pins", hostId, workspaceId] });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not refresh pins. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { query, act, busy, error: error ?? resultError, acknowledgeResult };
}
