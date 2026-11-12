import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isUnread, type Pin } from "../shared/pins";
import { PinAction } from "./pin-action";
import { PinIcon } from "./pin-icon";
import { PinMessage } from "./pin-message";
import { RepoSource } from "./repo-source";

const filledPin = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path fill="currentColor" d="M5 17h14l-3-5V5l2-2H6l2 2v7z"/></svg>',
};

const outlinePin = { svg: filledPin.svg.replace('fill="currentColor"', 'fill="none"') };

export function PinRow({
  pin,
  theme,
  compact,
  native,
  surface,
  touch,
  busy,
  onOpen,
  onRead,
  onKeep,
}: {
  pin: Pin;
  theme: PluginButtonContentProps["theme"];
  compact: boolean;
  native: boolean;
  surface: string;
  touch: boolean;
  busy: boolean;
  onOpen(): void;
  onRead(): void;
  onKeep(): void;
}) {
  const [activeTargets, setActiveTargets] = useState<Record<string, boolean>>({});
  const unread = isUnread(pin);
  const message = unread ? (pin.attention?.reason ?? "Unread update") : undefined;
  const active = Object.values(activeTargets).some(Boolean);
  function activate(target: string, value: boolean) {
    setActiveTargets((current) => ({ ...current, [target]: value }));
  }
  useEffect(() => {
    if (!unread)
      setActiveTargets((current) => ({
        ...current,
        ack: false,
        "message:hover": false,
        "message:focus": false,
        "message:press": false,
      }));
  }, [unread]);
  const linkEvents = (target: string) => ({
    onHoverIn: () => activate(`${target}:hover`, true),
    onHoverOut: () => activate(`${target}:hover`, false),
    onFocus: () => activate(`${target}:focus`, true),
    onBlur: () => activate(`${target}:focus`, false),
    onPressIn: () => activate(`${target}:press`, true),
    onPressOut: () => activate(`${target}:press`, false),
  });
  const actionProps = { theme, surface, touch, busy };
  const configured = pin.source === "repo";
  const resourceIcon = (
    <PinIcon
      type={pin.type}
      unread={unread}
      active={active}
      compact={compact}
      surface={surface}
      activeSurface={theme.colors.surface2}
      theme={theme}
      testID={`pin-unread-${pin.key}`}
    />
  );
  const titleText = (
    <Text
      style={{
        color: theme.colors.foreground,
        fontSize: native ? 14 : 13,
        lineHeight: 18,
        fontWeight: unread ? "600" : native ? "400" : "500",
      }}
    >
      {pin.title}
    </Text>
  );
  const hostText = (
    <Text
      numberOfLines={1}
      style={{
        color: theme.colors.foregroundMuted,
        fontSize: native ? 12 : 11,
        lineHeight: native ? 16 : 15,
      }}
    >
      {new URL(pin.url).host}
    </Text>
  );
  return (
    <View
      testID={`pin-row-${pin.key}`}
      style={{
        borderRadius: 8,
        borderWidth: compact ? 1 : 0,
        borderColor: "transparent",
        paddingRight: 4,
        opacity: busy ? 0.6 : 1,
        zIndex: active ? 2 : 0,
        backgroundColor: active ? theme.colors.surface2 : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {configured ? (
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "flex-start",
              paddingHorizontal: 8,
              paddingTop: 6,
              paddingBottom: touch ? 0 : 4,
              gap: 8,
              minWidth: 0,
            }}
          >
            <Pressable
              {...linkEvents("link")}
              accessibilityRole="link"
              accessibilityLabel={`${pin.title}. From repository.${unread ? " Unread." : ""} Opens in your browser. ${pin.url}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onOpen}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                borderRadius: 8,
              }}
            />
            <View pointerEvents="none" style={{ paddingTop: 2 }}>
              {resourceIcon}
            </View>
            <View pointerEvents="box-none" style={{ flex: 1, minWidth: 0 }}>
              <View pointerEvents="none">{titleText}</View>
              <View
                pointerEvents="box-none"
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <View pointerEvents="none" style={{ flexShrink: 1, minWidth: 0 }}>
                  {hostText}
                </View>
                <View pointerEvents="none">
                  <Text style={{ color: theme.colors.foregroundMuted }}>·</Text>
                </View>
                <RepoSource title={pin.title} theme={theme} touch={touch} />
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            {...linkEvents("link")}
            accessibilityRole="link"
            accessibilityLabel={`${pin.title}.${pin.kept ? " Kept." : ""}${unread ? " Unread." : ""} Opens in your browser. ${pin.url}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onOpen}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 4,
              paddingHorizontal: 8,
              gap: 8,
              borderRadius: 8,
              minHeight: touch ? 44 : undefined,
            }}
          >
            {resourceIcon}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {titleText}
              {hostText}
            </View>
          </Pressable>
        )}
        {!configured && (
          <PinAction
            {...actionProps}
            icon={pin.kept ? filledPin : outlinePin}
            selected={pin.kept}
            visible={touch || active || pin.kept}
            label={`${pin.kept ? "Allow removal of" : "Keep"} ${pin.title}`}
            tooltip={pin.kept ? "Allow removal" : "Keep this pin"}
            onActive={(value) => activate("keep", value)}
            onPress={onKeep}
          />
        )}
      </View>
      {message && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingLeft: compact ? 32 : 36,
            paddingBottom: 4,
          }}
        >
          <Pressable
            {...linkEvents("message")}
            accessibilityRole="link"
            accessibilityLabel={`${message} Open ${pin.title}.`}
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={onOpen}
            style={{ flex: 1, minWidth: 0 }}
          >
            <PinMessage message={message} theme={theme} />
          </Pressable>
          <PinAction
            {...actionProps}
            icon="Check"
            label={`Mark ${pin.title} as read`}
            tooltip="Mark as read"
            onActive={(value) => activate("ack", value)}
            onPress={onRead}
          />
        </View>
      )}
    </View>
  );
}
