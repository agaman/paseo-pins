import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type AcknowledgmentEntries, acknowledgePins, listPins, setPinKept } from "../shared/pins";

export function usePins(hostId: string, workspaceId: string) {
  const list = useRpc(listPins);
  const acknowledge = useRpc(acknowledgePins);
  const keep = useRpc(setPinKept);
  const cache = useQueryClient();
  const queryKey = ["pins", hostId, workspaceId];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await list({ workspaceId });
      // RPC cannot abort the transport; consuming the signal still prevents stale cache writes.
      if (signal.aborted) throw new Error("Pins fetch canceled.");
      return result;
    },
    refetchInterval: 2000,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    retry: false,
  });

  async function markRead(entries: AcknowledgmentEntries) {
    await cache.cancelQueries({ queryKey });
    const result = await acknowledge({ workspaceId, entries });
    await cache.cancelQueries({ queryKey });
    cache.setQueryData(queryKey, {
      pins: result.pins,
      sections: result.sections,
      unreadCount: result.unreadCount,
    });
    void cache.invalidateQueries({ queryKey });
  }

  async function setKept(key: string, instanceId: string, kept: boolean) {
    await cache.cancelQueries({ queryKey });
    const result = await keep({ workspaceId, key, instanceId, kept });
    await cache.cancelQueries({ queryKey });
    cache.setQueryData(queryKey, result);
    void cache.invalidateQueries({ queryKey });
  }

  return { query, markRead, setKept };
}
