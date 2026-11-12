import { openExternalUrl, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type AcknowledgmentEntries, isUnread, type Pin } from "../shared/pins";
import { groupPins } from "../shared/sections";
import { MenuAction } from "./menu-action";
import { PinRow } from "./pin-row";
import { usePins } from "./use-pins";
import { useTouchControls } from "./web";

type FailedAcknowledgment = { entries: AcknowledgmentEntries; opened: boolean };

export function PinsPopover({ workspaceId, host, theme, layout, close }: PluginButtonContentProps) {
  const { query, markRead } = usePins(host.id, workspaceId);
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
  const unreadEntries = (query.data?.pins ?? []).flatMap((pin) =>
    isUnread(pin) && pin.attention ? [{ key: pin.key, attentionToken: pin.attention.token }] : [],
  );

  return (
    <View
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
        {Boolean(query.data?.pins.length) && (
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
          <Text style={{ ...muted, textAlign: "center", paddingVertical: 12 }}>No pins yet</Text>
        )}
        {groupPins(query.data?.pins ?? [], query.data?.sections ?? []).map((group, index) => (
          <View
            key={group.section ? `section:${group.section.key}` : "unsectioned"}
            style={
              index > 0
                ? {
                    marginTop: 5,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    marginHorizontal: -4,
                    paddingHorizontal: 4,
                    paddingTop: 2,
                  }
                : undefined
            }
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
                onRead={() => {
                  if (pin.attention)
                    void read([{ key: pin.key, attentionToken: pin.attention.token }]);
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
