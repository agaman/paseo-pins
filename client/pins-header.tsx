import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { usePins } from "./use-pins";

export function PinsHeader({
  host,
  workspaceId,
  size,
  color,
  onCount,
}: PluginButtonIconProps & {
  onCount(count: number): void;
}) {
  const { query } = usePins(host.id, workspaceId);
  const count = query.data?.unreadCount;
  useEffect(() => {
    if (count !== undefined) onCount(count);
  }, [count, onCount]);
  return <Icon name="Pin" size={size} color={color} />;
}
