import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { tooltipContentStyle, tooltipSurfaceStyle, tooltipTextStyle } from "../theme";
import { actionTooltips } from "../ui/tooltip-state";
import { visibleWebBounds } from "../web";

type Anchor = {
  target: View;
  x: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  left: number;
  visibleTop: number;
  pinned: boolean;
};
type SourceContext = {
  show(anchor: View | null, pinned: boolean): void;
  toggle(anchor: View | null): void;
  isExpanded(anchor: View | null): boolean;
  leave(): void;
  close(): void;
};
const Context = createContext<SourceContext | null>(null);
declare const window: {
  addEventListener(
    type: string,
    listener: (event: { key?: string; target?: unknown }) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { key?: string; target?: unknown }) => void,
    capture?: boolean,
  ): void;
};

export function RepoSourceLayer({
  children,
  theme,
  style,
}: {
  children: ReactNode;
  theme: PluginButtonContentProps["theme"];
  style: ViewStyle;
}) {
  const root = useRef<View>(null);
  const popup = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [height, setHeight] = useState(100);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  function close() {
    generation.current++;
    cancelTimer();
    setAnchor(null);
  }
  useEffect(
    () => () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!anchor) return;
    const dismiss = (event: { key?: string }) => {
      if (event.key === "Escape") {
        generation.current++;
        setAnchor(null);
      }
    };
    if (Platform.OS === "web") {
      const viewportChanged = () => {
        generation.current++;
        setAnchor(null);
      };
      const scrolled = (event: { target?: unknown }) => {
        const element = popup.current as unknown as { contains(target: unknown): boolean } | null;
        if (element?.contains(event.target)) return;
        viewportChanged();
      };
      window.addEventListener("keydown", dismiss);
      window.addEventListener("scroll", scrolled, true);
      window.addEventListener("resize", viewportChanged);
      return () => {
        window.removeEventListener("keydown", dismiss);
        window.removeEventListener("scroll", scrolled, true);
        window.removeEventListener("resize", viewportChanged);
      };
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      generation.current++;
      setAnchor(null);
      return true;
    });
    return () => subscription.remove();
  }, [anchor]);
  useEffect(
    () =>
      actionTooltips.subscribe(() => {
        if (actionTooltips.hasOpen()) {
          generation.current++;
          setAnchor(null);
        }
      }),
    [],
  );
  function show(target: View | null, pinned: boolean) {
    if (!target || (anchor?.target === target && anchor.pinned && !pinned)) return;
    actionTooltips.hide();
    cancelTimer();
    const token = ++generation.current;
    root.current?.measureInWindow((x, y, width, rootHeight) => {
      target?.measureInWindow((ax, ay, aw, ah) => {
        if (token !== generation.current || !width || !rootHeight) return;
        const windowSize = Dimensions.get("window");
        const visible = visibleWebBounds(root.current, {
          left: Math.max(0, x),
          top: Math.max(0, y),
          right: Math.min(windowSize.width, x + width),
          bottom: Math.min(windowSize.height, y + rootHeight),
        });
        if (visible.right <= visible.left || visible.bottom <= visible.top) return;
        setAnchor({
          target,
          x: ax + aw - x,
          top: ay - y,
          bottom: ay + ah - y,
          width: visible.right - visible.left,
          height: visible.bottom - visible.top,
          left: visible.left - x,
          visibleTop: visible.top - y,
          pinned,
        });
      });
    });
  }
  function leave() {
    generation.current++;
    cancelTimer();
    timer.current = setTimeout(() => {
      setAnchor((current) => (current?.pinned ? current : null));
    }, 120);
  }
  function toggle(target: View | null) {
    if (anchor?.target === target && anchor?.pinned) close();
    else show(target, true);
  }
  const width = anchor ? Math.min(216, anchor.width - 12) : 216;
  const top = anchor
    ? Math.max(
        anchor.visibleTop + 6,
        Math.min(
          anchor.bottom + height + 5 <= anchor.visibleTop + anchor.height - 6
            ? anchor.bottom + 5
            : anchor.top - height - 5,
          anchor.visibleTop + anchor.height - height - 6,
        ),
      )
    : 0;
  return (
    <View
      ref={root}
      collapsable={false}
      style={style}
      onLayout={() => {
        if (anchor) close();
      }}
    >
      <Context.Provider
        value={{ show, toggle, isExpanded: (target) => anchor?.target === target, leave, close }}
      >
        {children}
      </Context.Provider>
      {anchor && (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}
        >
          {anchor.pinned && (
            <Pressable
              testID="repo-source-dismiss-overlay"
              accessible={false}
              focusable={false}
              onPress={close}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: "transparent",
                borderWidth: 0,
                borderRadius: 0,
              }}
            />
          )}
          <View
            ref={popup}
            testID="repo-source-popover"
            onAccessibilityEscape={close}
            onPointerEnter={cancelTimer}
            onPointerLeave={leave}
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            style={{
              position: "absolute",
              top,
              left: Math.max(
                anchor.left + 6,
                Math.min(anchor.x - width, anchor.left + anchor.width - width - 6),
              ),
              width,
              maxHeight: Math.max(30, anchor.height - 12),
              ...tooltipSurfaceStyle(theme),
            }}
          >
            <ScrollView contentContainerStyle={{ ...tooltipContentStyle, gap: 4 }}>
              <Text
                style={{
                  ...tooltipTextStyle(theme),
                  fontWeight: "500",
                }}
              >
                From repository
              </Text>
              <Text style={{ ...tooltipTextStyle(theme), color: theme.colors.foregroundMuted }}>
                Defined in .paseo/pins.json. Changes to this pin come from that file.
              </Text>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

export function RepoSource({
  title,
  theme,
  touch,
}: {
  title: string;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
}) {
  const context = useContext(Context);
  const ref = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`Repository source for ${title}`}
      accessibilityHint="Shows where this pin is defined"
      accessibilityState={{ expanded: context?.isExpanded(ref.current) ?? false }}
      aria-expanded={context?.isExpanded(ref.current) ?? false}
      onAccessibilityEscape={() => context?.close()}
      onHoverIn={() => {
        if (!touch) context?.show(ref.current, false);
      }}
      onHoverOut={() => context?.leave()}
      onFocus={() => {
        setFocused(true);
        context?.show(ref.current, false);
      }}
      onBlur={() => {
        setFocused(false);
        context?.leave();
      }}
      onPress={() => context?.toggle(ref.current)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        minHeight: touch ? 44 : 18,
        minWidth: touch ? 54 : undefined,
        borderWidth: 1,
        borderColor: focused ? theme.colors.accent : "transparent",
        borderRadius: 2,
      }}
    >
      <Icon name="Settings" size={12} color={theme.colors.foregroundMuted} />
      <Text
        style={{ color: theme.colors.foregroundMuted, fontSize: touch ? 12 : 11, lineHeight: 16 }}
      >
        Repo
      </Text>
    </Pressable>
  );
}
