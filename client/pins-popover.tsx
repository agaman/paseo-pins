import { openExternalUrl, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type AcknowledgmentEntries, isUnread, type Pin } from "../shared/pins";
import { groupPins } from "../shared/sections";
import { MenuAction } from "./menu-action";
import { PinRow } from "./pin-row";
import { RefreshResult } from "./refresh-result";
import { RepoSourceLayer } from "./repo-source";
import { usePins } from "./use-pins";
import { useRefresh } from "./use-refresh";
import { useTouchControls } from "./web";

type FailedAcknowledgment = { entries: AcknowledgmentEntries; opened: boolean };

export function PinsPopover({
  workspaceId,
  host,
  theme,
  layout,
  close,
  openSettings,
}: PluginButtonContentProps & { openSettings: () => void }) {
  const { query, markRead, setKept } = usePins(host.id, workspaceId);
  const refresh = useRefresh(host.id, workspaceId);
  const run = refresh.query.data?.run;
  const refreshing = Boolean(run && (!run.outcome || run.cleanupPending));
  const touch = useTouchControls();
  const native = layout.platform !== "web";
  // Paseo owns the background. Match its surface only for the unread dot's cutout.
  const surface = layout.compact
    ? native
      ? theme.colors.surface0
      : theme.colors.surface2
    : theme.colors.surface1;
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedAcknowledgment | null>(null);
  const foreground = { color: theme.colors.foreground, fontSize: native ? 14 : 13, lineHeight: 18 };
  const muted = { ...foreground, color: theme.colors.foregroundMuted };
  const error =
    actionError ??
    (query.isError
      ? query.data
        ? "Couldn't refresh pins. Showing the last saved list."
        : "Couldn't load pins."
      : null);

  function start() {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    setFailed(null);
    return true;
  }
  function finish() {
    inFlight.current = false;
    setBusy(false);
  }
  async function acknowledge(entries: AcknowledgmentEntries, opened = false) {
    try {
      await markRead(entries);
      if (opened) close();
    } catch {
      setFailed({ entries, opened });
      setActionError(
        opened ? "Link opened, but couldn't mark it as read." : "Couldn't mark pins as read.",
      );
    }
  }
  async function read(entries: AcknowledgmentEntries, opened = false) {
    if (!start()) return;
    try {
      await acknowledge(entries, opened);
    } finally {
      finish();
    }
  }
  async function open(pin: Pin) {
    if (!start()) return;
    try {
      // Call from the press handler before awaiting, to preserve the browser's user gesture.
      await openExternalUrl(pin.url);
      if (isUnread(pin) && pin.attention) {
        await acknowledge([{ key: pin.key, attentionToken: pin.attention.token }], true);
      } else close();
    } catch {
      setActionError("Couldn't open that link. Please try again.");
    } finally {
      finish();
    }
  }
  async function toggleKeep(pin: Pin) {
    if (!start()) return;
    try {
      await setKept(pin.key, pin.instanceId, !pin.kept);
    } catch {
      setActionError("Couldn't change Keep. Refresh the list and try again.");
      void query.refetch();
    } finally {
      finish();
    }
  }
  const unreadEntries = (query.data?.pins ?? []).flatMap((pin) =>
    isUnread(pin) && pin.attention ? [{ key: pin.key, attentionToken: pin.attention.token }] : [],
  );

  const groups = groupPins(query.data?.pins ?? [], query.data?.sections ?? []);

  return (
    <RepoSourceLayer
      theme={theme}
      style={{
        // Paseo enforces a 280px popover minimum: 2px border + 24px host padding.
        width: layout.compact ? "100%" : 254,
        maxWidth: "100%",
      }}
    >
      {/* Cancel the host content padding down to the built-in menu's four-pixel row inset. */}
      <View
        style={{
          gap: 0,
          marginHorizontal: -8,
          marginVertical: -12,
        }}
      >
        {
          <View
            testID="pins-actions"
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 4,
              // Extend the divider through the host inset, preserving action alignment.
              marginHorizontal: -4,
              paddingLeft: 4,
              paddingRight: 8,
              marginTop: layout.compact ? 0 : -2,
              marginBottom: 4,
              paddingBottom: 4,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              zIndex: groups.length + 2,
            }}
          >
            <MenuAction
              icon="RefreshCw"
              label="Refresh pins"
              tooltip="Refresh pins"
              theme={theme}
              touch={touch}
              disabled={refresh.busy || refreshing || refresh.query.isPending}
              busy={refresh.busy || refreshing}
              onPress={() => {
                if (refresh.query.data?.configured) void refresh.act();
                else openSettings();
              }}
            />
            <MenuAction
              icon="ListChecks"
              label="Mark all pins as read"
              tooltip="Mark as read"
              theme={theme}
              touch={touch}
              disabled={busy || unreadEntries.length === 0}
              busy={busy}
              onPress={() => {
                void read(unreadEntries);
              }}
            />
          </View>
        }
        {query.data?.config?.error && (
          <View style={{ padding: 8, gap: 5 }}>
            <Text accessibilityRole="alert" style={muted}>
              {query.data.config.loaded
                ? "Couldn't load repository pins. Using the last valid configuration."
                : "Couldn't load repository pins. No repository pins were loaded."}
            </Text>
            <Text style={muted}>{query.data.config.error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void query.refetch();
              }}
            >
              <Text style={foreground}>Retry</Text>
            </Pressable>
          </View>
        )}
        {run && (
          <View style={{ zIndex: groups.length + 1 }}>
            <RefreshResult
              key={run.id}
              run={run}
              hostId={host.id}
              workspaceId={workspaceId}
              theme={theme}
              touch={touch}
              busy={refresh.busy}
              cancel={() => {
                void refresh.act(run.id);
              }}
            />
          </View>
        )}
        {(refresh.error || refresh.query.isError) && (
          <View style={{ padding: 8, gap: 5 }}>
            <Text accessibilityRole="alert" style={muted}>
              {refresh.error ?? "Couldn’t load refresh status."}
            </Text>
            <Pressable accessibilityRole="button" onPress={openSettings}>
              <Text style={foreground}>Pins settings</Text>
            </Pressable>
          </View>
        )}
        {query.isPending && <Text style={muted}>Loading pins…</Text>}
        {error && (
          <View style={{ gap: 8, padding: 4 }}>
            <Text accessibilityRole="alert" style={foreground}>
              {error}
            </Text>
            {(failed || query.isError) && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={() => {
                  if (failed) void read(failed.entries, failed.opened);
                  else void query.refetch();
                }}
                style={{ paddingVertical: 8 }}
              >
                <Text style={foreground}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}
        {query.data?.pins.length === 0 && (
          <Text style={{ ...muted, textAlign: "center", paddingVertical: 12 }}>No pins yet</Text>
        )}
        {groups.map((group, index) => (
          <View
            key={group.section ? `section:${group.section.key}` : "unsectioned"}
            style={[
              // Downward tooltips must paint above later sections and their dividers.
              { zIndex: groups.length - index },
              index > 0
                ? {
                    marginTop: 5,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    marginHorizontal: -4,
                    paddingHorizontal: 4,
                    paddingTop: 2,
                  }
                : undefined,
            ]}
          >
            {group.section && (
              <Text
                accessibilityRole="header"
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: native ? 12 : 11,
                  fontWeight: "500",
                  lineHeight: 16,
                  paddingTop: 7,
                  paddingBottom: 3,
                  paddingHorizontal: 8,
                }}
              >
                {group.section.title}
              </Text>
            )}
            {group.pins.map((pin) => (
              <PinRow
                key={pin.key}
                pin={pin}
                theme={theme}
                compact={layout.compact}
                native={native}
                surface={surface}
                touch={touch}
                busy={busy}
                onOpen={() => {
                  void open(pin);
                }}
                onKeep={() => {
                  void toggleKeep(pin);
                }}
                onRead={() => {
                  if (pin.attention)
                    void read([{ key: pin.key, attentionToken: pin.attention.token }]);
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </RepoSourceLayer>
  );
}
