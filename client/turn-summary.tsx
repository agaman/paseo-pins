import { openExternalUrl, type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { SummaryEntry } from "../shared/pins";
import {
  acknowledgeSummary,
  readSummary,
  summaryEntryUnread,
  type summaryReferenceSchema,
} from "../shared/summaries";
import { MenuAction } from "./menu-action";
import { SummaryRow } from "./summary-row";
import { usePins } from "./use-pins";
import { useTouchControls } from "./web";

type Props = PluginTimelineItemProps<z.infer<typeof summaryReferenceSchema>>;

export function TurnSummary({ item, agentId, host, theme, layout }: Props) {
  const input = { ...item.data, agentId };
  const list = useRpc(readSummary);
  const acknowledge = useRpc(acknowledgeSummary);
  const cache = useQueryClient();
  const { query: pins, markRead } = usePins(host.id, input.workspaceId);
  const touch = useTouchControls();
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<"retry" | "expand" | "collapse" | null>(null);
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<{ message: string; retry: () => Promise<void> } | null>(
    null,
  );
  const queryKey = ["pin-summary", host.id, input.workspaceId, agentId, input.summaryId];
  const summary = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      list({ ...input, offset: pageParam, limit: pageParam === 0 ? 3 : 25 }),
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((count, page) => count + page.entries.length, 0);
      return count < last.total ? count : undefined;
    },
    retry: false,
  });
  // Structural sharing means polling does not invalidate history unless the pins changed.
  useEffect(() => {
    if (pins.data)
      void cache.invalidateQueries({
        queryKey: ["pin-summary", host.id, item.data.workspaceId, agentId, item.data.summaryId],
      });
  }, [pins.data, cache, host.id, item.data.workspaceId, agentId, item.data.summaryId]);
  const meta = summary.data?.pages[0];
  const entries = summary.data?.pages.flatMap((page) => page.entries) ?? [];

  async function perform(action: () => Promise<void>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch {
      setFailure({ message, retry: action });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function markSummaryRead() {
    await acknowledge(input);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["pins", host.id, input.workspaceId] }),
      cache.invalidateQueries({ queryKey }),
    ]);
  }

  function open(entry: SummaryEntry) {
    // Start from the press gesture; an acknowledgment retry must never open a second tab.
    void perform(async () => {
      await openExternalUrl(entry.url);
      const attentionToken = entry.attentionToken;
      if (!attentionToken) return;
      try {
        await markRead([{ key: entry.key, attentionToken }]);
      } catch {
        setFailure({
          message: "Link opened, but couldn't mark it as read.",
          retry: () => markRead([{ key: entry.key, attentionToken }]),
        });
      }
    }, "Couldn't open that link. Please try again.");
  }

  async function expand() {
    setExpanded(true);
    let result = await summary.fetchNextPage({ throwOnError: true });
    while (result.hasNextPage) result = await summary.fetchNextPage({ throwOnError: true });
  }

  const muted = { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 };
  const error =
    failure?.message ??
    (summary.isError
      ? "Couldn't load pin updates."
      : pins.isError
        ? "Couldn't refresh read state. Showing the last saved state."
        : null);
  const retry = () =>
    void perform(
      failure?.retry ??
        (async () => {
          await Promise.all([
            summary.refetch({ throwOnError: true }),
            pins.refetch({ throwOnError: true }),
          ]);
        }),
      failure?.message ?? "Couldn't refresh pin updates.",
    );
  return (
    <View
      testID="pin-turn-summary"
      style={{
        marginVertical: 8,
        width: "100%",
        gap: collapsed ? 0 : 2,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: touch ? 44 : 32,
          gap: 4,
          zIndex: 1,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pins"
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => setCollapsed((value) => !value)}
          onHoverIn={() => setHeaderHovered(true)}
          onHoverOut={() => setHeaderHovered(false)}
          onFocus={() => setFocused("collapse")}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: touch ? 44 : 36,
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            paddingHorizontal: 2,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: focused === "collapse" ? theme.colors.accent : "transparent",
            backgroundColor: pressed || headerHovered ? theme.colors.border : "transparent",
          })}
        >
          <Icon name="Pin" size={16} color={theme.colors.foregroundMuted} />
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: 15,
              lineHeight: 22,
              fontWeight: "500",
              flexShrink: 1,
            }}
          >
            Pins
          </Text>
        </Pressable>
        <MenuAction
          icon="ListChecks"
          label="Mark updates in this summary as read"
          tooltip="Mark as read"
          theme={theme}
          touch={touch}
          busy={busy}
          disabled={busy || !meta?.unreadCount || !pins.data || pins.isError || summary.isError}
          onPress={() => void perform(markSummaryRead, "Couldn't mark these updates as read.")}
        />
        <MenuAction
          icon={collapsed ? "ChevronRight" : "ChevronDown"}
          label={collapsed ? "Expand pin summary" : "Collapse pin summary"}
          tooltip={collapsed ? "Expand pins" : "Collapse pins"}
          expanded={!collapsed}
          theme={theme}
          touch={touch}
          busy={false}
          disabled={false}
          onPress={() => setCollapsed((value) => !value)}
        />
      </View>
      {!collapsed && (
        <View
          testID="pin-summary-items"
          style={{
            borderLeftWidth: 1,
            borderLeftColor: theme.colors.border,
            marginLeft: 9,
            paddingLeft: layout.compact ? 10 : 14,
            paddingVertical: 2,
          }}
        >
          {(meta?.outcome === "interrupted" || meta?.recovered) && (
            <Text style={{ ...muted, paddingHorizontal: 8 }}>
              {[
                meta.outcome === "interrupted" ? "Turn interrupted" : null,
                meta.recovered ? new Date(meta.startedAt).toLocaleString() : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
          {summary.isPending && <Text style={{ ...muted, padding: 8 }}>Loading pin updates…</Text>}
          {error && (
            <View style={{ padding: 8, gap: 4 }}>
              <Text accessibilityRole="alert" style={muted}>
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry pin summary action"
                disabled={busy}
                onPress={retry}
                onFocus={() => setFocused("retry")}
                onBlur={() => setFocused(null)}
                style={{
                  minHeight: touch ? 44 : 28,
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: focused === "retry" ? theme.colors.accent : "transparent",
                }}
              >
                <Text
                  style={{
                    ...muted,
                    color: theme.colors.foreground,
                    textDecorationLine: "underline",
                  }}
                >
                  Retry
                </Text>
              </Pressable>
            </View>
          )}
          {(expanded ? entries : entries.slice(0, 3)).map((entry) => (
            <SummaryRow
              key={entry.instanceId}
              entry={entry}
              unread={summaryEntryUnread(entry, pins.data?.pins ?? [])}
              theme={theme}
              compact={layout.compact}
              busy={busy}
              onOpen={() => open(entry)}
            />
          ))}
          {Boolean(meta && meta.total > 3) && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded, disabled: busy }}
              onFocus={() => setFocused("expand")}
              onBlur={() => setFocused(null)}
              disabled={busy}
              onPress={() =>
                expanded
                  ? setExpanded(false)
                  : void perform(expand, "Couldn't load the remaining pins.")
              }
              style={({ pressed }) => ({
                minHeight: touch ? 44 : 34,
                paddingHorizontal: 8,
                borderRadius: 6,
                alignItems: "flex-start",
                justifyContent: "center",
                backgroundColor:
                  pressed || focused === "expand" ? theme.colors.border : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={muted}>{expanded ? "Show less" : `Show all ${meta?.total}`}</Text>
                <Icon
                  name={expanded ? "ChevronUp" : "ChevronDown"}
                  size={12}
                  color={theme.colors.foregroundMuted}
                />
              </View>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
