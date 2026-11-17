import { openExternalUrl, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import type { AcknowledgmentEntries } from "../../shared/pin-rpc";
import { isUnread, type Pin } from "../../shared/pins";
import { groupPins } from "../../shared/sections";
import { RefreshResult } from "../refresh/result";
import { useRefresh } from "../refresh/use-refresh";
import { requestId } from "../request-id";
import { MenuAction } from "../ui/menu-action";
import { usePins } from "../use-pins";
import { useTouchControls } from "../web";
import { PinRow } from "./pin-row";
import { RepoSourceLayer } from "./repo-source";

type FailedAcknowledgment = { entries: AcknowledgmentEntries; opened: boolean };

export function PinsPopover({
  workspaceId,
  host,
  theme,
  layout,
  close,
  openSettings,
}: PluginButtonContentProps & { openSettings: () => void }) {
  const { query, markRead, setKept, removeUserPin, undoRemoval } = usePins(host.id, workspaceId);
  const refresh = useRefresh(host.id, workspaceId);
  const run = refresh.query.data?.run;
  const refreshing = Boolean(run && (!run.outcome || run.cleanupPending));
  const empty = query.data?.pins.length === 0;
  const startingDiscovery = useRef(false);
  const discovery = refreshing
    ? run?.initialCount === 0
    : refresh.busy
      ? startingDiscovery.current
      : empty;
  const refreshLabel = discovery ? "Find pins" : "Refresh pins";
  const refreshIcon = discovery ? "Search" : "RefreshCw";
  const refreshDisabled =
    refresh.busy || refreshing || refresh.query.isPending || refresh.query.isError || !query.data;
  function refreshPins() {
    startingDiscovery.current = empty;
    if (refresh.query.data?.configured) void refresh.act();
    else openSettings();
  }
  const touch = useTouchControls();
  const native = layout.platform !== "web";
  const bottomActions = layout.compact && !native;
  // Match the host surface for the unread dot cutout and opaque sticky toolbar.
  // Paseo's SheetBackground uses surface0 on both native and compact web.
  const surface = layout.compact ? theme.colors.surface0 : theme.colors.surface1;
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedAcknowledgment | null>(null);
  const [removal, setRemoval] = useState<{ id: string; title: string } | null>(null);
  const [failedRemoval, setFailedRemoval] = useState<{ pin: Pin; requestId: string } | null>(null);
  const [failedUndo, setFailedUndo] = useState(false);
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
    setFailedRemoval(null);
    setFailedUndo(false);
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
  async function remove(pin: Pin, id = requestId()) {
    if (!start()) return;
    try {
      setRemoval(await removeUserPin(pin.key, pin.instanceId, id));
    } catch (error) {
      setFailedRemoval({ pin, requestId: id });
      setActionError(
        error instanceof Error ? error.message : "Couldn't remove this pin. Please try again.",
      );
      void query.refetch();
    } finally {
      finish();
    }
  }
  async function undo() {
    if (!removal || !start()) return;
    try {
      await undoRemoval(removal.id);
      setRemoval(null);
    } catch (error) {
      setFailedUndo(true);
      setActionError(
        error instanceof Error ? error.message : "Couldn't undo removal. Please try again.",
      );
      void query.refetch();
    } finally {
      finish();
    }
  }
  const unreadEntries = (query.data?.pins ?? []).flatMap((pin) =>
    isUnread(pin) && pin.attention ? [{ key: pin.key, attentionToken: pin.attention.token }] : [],
  );

  const groups = groupPins(query.data?.pins ?? [], query.data?.sections ?? []);

  const actions = (
    <View
      testID="pins-actions"
      style={{
        flexDirection: "row",
        justifyContent: bottomActions ? "space-around" : "flex-end",
        gap: 4,
        // Extend the divider through the host inset, preserving action alignment.
        marginHorizontal: -4,
        paddingLeft: 4,
        paddingRight: 8,
        marginTop: layout.compact ? 0 : -2,
        marginBottom: bottomActions ? 0 : 4,
        paddingBottom: bottomActions ? 0 : 4,
        borderBottomWidth: bottomActions ? 0 : 1,
        borderTopWidth: bottomActions ? 1 : 0,
        borderTopColor: theme.colors.border,
        backgroundColor: surface,
        borderBottomColor: theme.colors.border,
        zIndex: groups.length + 2,
        // Web CSS sticks within the host's scroll area without introducing a second scroller.
        // Native sheets own their ScrollView and expose no sticky-header registration.
        ...(!native && !bottomActions
          ? {
              position: "sticky" as ViewStyle["position"],
              // Match the resting inset: desktop host padding (4px) minus our 2px top trim.
              top: layout.compact ? 0 : 2,
              backgroundColor: surface,
            }
          : {}),
      }}
    >
      {!native && !bottomActions && (
        <View
          pointerEvents="none"
          accessible={false}
          style={{
            // Cover the host's top inset as rows pass behind the sticky toolbar.
            position: "absolute",
            top: -16,
            height: 16,
            left: 0,
            right: 0,
            backgroundColor: surface,
          }}
        />
      )}
      {!empty && (
        <>
          <MenuAction
            icon={refreshIcon}
            label={refreshLabel}
            tooltip={refreshLabel}
            placement={bottomActions ? "above" : "below"}
            tooltipAlign={bottomActions ? "left" : "right"}
            theme={theme}
            touch={touch}
            disabled={refreshDisabled}
            busy={refresh.busy || refreshing}
            onPress={refreshPins}
          />
          <MenuAction
            icon="ListChecks"
            label="Mark all pins as read"
            tooltip="Mark as read"
            placement={bottomActions ? "above" : "below"}
            theme={theme}
            touch={touch}
            disabled={busy || unreadEntries.length === 0}
            busy={busy}
            onPress={() => {
              void read(unreadEntries);
            }}
          />
        </>
      )}
      <MenuAction
        icon="Settings"
        label="Pins settings"
        tooltip="Pins settings"
        placement={bottomActions ? "above" : "below"}
        theme={theme}
        touch={touch}
        disabled={false}
        busy={false}
        onPress={openSettings}
      />
    </View>
  );

  const removalNotice = removal && (
    <View
      testID="pin-removal-notice"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        marginHorizontal: -4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: surface,
        zIndex: groups.length + 1,
        ...(!native && !bottomActions
          ? { position: "sticky" as ViewStyle["position"], bottom: 0 }
          : {}),
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }} accessibilityLiveRegion="polite">
        <Text style={foreground} numberOfLines={2}>
          {removal.title}
        </Text>
        <Text style={muted}>Removed from Pins</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Undo removal of ${removal.title}`}
        disabled={busy}
        accessibilityState={{ disabled: busy }}
        onPress={() => {
          void undo();
        }}
        style={({ pressed }) => ({
          minHeight: touch ? 44 : 28,
          justifyContent: "center",
          paddingHorizontal: 4,
          opacity: busy ? 0.4 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ ...foreground, color: theme.colors.accent, fontWeight: "600" }}>Undo</Text>
      </Pressable>
    </View>
  );

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
        {!bottomActions && actions}
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
        {run && refresh.query.data?.presentation && (
          <View style={{ zIndex: groups.length + 1 }}>
            <RefreshResult
              key={run.id}
              run={run}
              presentation={refresh.query.data.presentation}
              acknowledge={(action) => refresh.acknowledgeResult(run.id, action)}
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
            {(failed || failedRemoval || failedUndo || query.isError) && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={() => {
                  if (failedRemoval) void remove(failedRemoval.pin, failedRemoval.requestId);
                  else if (failedUndo) void undo();
                  else if (failed) void read(failed.entries, failed.opened);
                  else void query.refetch();
                }}
                style={{ paddingVertical: 8 }}
              >
                <Text style={foreground}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}
        {empty && (
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
            <Text style={{ ...muted, textAlign: "center" }}>No pins yet</Text>
            <MenuAction
              icon={refreshIcon}
              label={refreshLabel}
              tooltip={refreshLabel}
              showLabel
              theme={theme}
              touch={touch}
              disabled={refreshDisabled}
              busy={refresh.busy || refreshing}
              onPress={refreshPins}
            />
          </View>
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
                onRemove={() => {
                  void remove(pin);
                }}
                onRead={() => {
                  if (pin.attention)
                    void read([{ key: pin.key, attentionToken: pin.attention.token }]);
                }}
              />
            ))}
          </View>
        ))}
        {bottomActions ? (
          <View
            testID="pins-footer"
            style={{
              position: "sticky" as ViewStyle["position"],
              // Match the host page inset and sheet safe-area padding.
              bottom: "calc(8px + env(safe-area-inset-bottom, 0px))" as ViewStyle["bottom"],
              // Paint the inset without an absolute child extending the scroll range.
              boxShadow: `0 calc(8px + env(safe-area-inset-bottom, 0px)) 0 0 ${surface}`,
              backgroundColor: surface,
              zIndex: groups.length + 2,
            }}
          >
            {removalNotice}
            {actions}
          </View>
        ) : (
          removalNotice
        )}
      </View>
    </RepoSourceLayer>
  );
}
