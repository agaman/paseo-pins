import { openExternalUrl, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type AcknowledgmentEntries, isUnread, type Pin } from "../shared/pins";
import { MenuAction } from "./menu-action";
import { PinRow } from "./pin-row";
import { usePins } from "./use-pins";
import { useTouchControls } from "./web";

type FailedAcknowledgment = { entries: AcknowledgmentEntries; opened: boolean };

export function PinsPopover({ workspaceId, host, theme, layout, close }: PluginButtonContentProps) {
  const { query, markRead } = usePins(host.id, workspaceId);
  const touch = useTouchControls();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedAcknowledgment | null>(null);
  const foreground = { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };
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
  const unreadEntries = (query.data?.pins ?? []).flatMap((pin) =>
    isUnread(pin) && pin.attention ? [{ key: pin.key, attentionToken: pin.attention.token }] : [],
  );

  return (
    <View style={{ width: layout.compact ? "100%" : 252, maxWidth: "100%" }}>
      {/* Paint our content through Paseo's padding; the host still owns the outer chrome. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -16,
          bottom: -16,
          left: -12,
          right: -12,
          backgroundColor: theme.colors.surface2,
          borderRadius: layout.compact ? 0 : 8,
        }}
      />
      {/* Four-pixel desktop row inset, matching the built-in menu. */}
      <View
        style={{
          gap: 0,
          marginHorizontal: layout.compact ? 0 : -8,
          marginVertical: layout.compact ? 0 : -12,
        }}
      >
        {Boolean(query.data?.pins.length) && (
          <View
            testID="pins-actions"
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 4,
              // Extend the divider through the host inset, preserving action alignment.
              marginHorizontal: layout.compact ? -12 : -4,
              paddingLeft: layout.compact ? 12 : 4,
              paddingRight: layout.compact ? 16 : 8,
              marginTop: layout.compact ? 0 : -2,
              marginBottom: layout.compact ? 12 : 4,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              zIndex: 1,
            }}
          >
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
          <Text style={muted}>No pins yet. Ask an agent to pin a useful link.</Text>
        )}
        {query.data?.pins.map((pin) => (
          <PinRow
            key={pin.key}
            pin={pin}
            theme={theme}
            touch={touch}
            busy={busy}
            onOpen={() => {
              void open(pin);
            }}
            onRead={() => {
              if (pin.attention) void read([{ key: pin.key, attentionToken: pin.attention.token }]);
            }}
          />
        ))}
      </View>
    </View>
  );
}
