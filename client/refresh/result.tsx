import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type RefreshPresentation,
  type RefreshView,
  refreshHasError,
  refreshTitle,
} from "../../shared/refresh";
import { MenuAction } from "../ui/menu-action";
import { useRefreshResultView } from "./use-refresh-result-view";

export function RefreshResult({
  run,
  presentation,
  acknowledge,
  theme,
  touch,
  busy,
  cancel,
}: {
  run: RefreshView;
  presentation: RefreshPresentation;
  acknowledge(action: "viewed" | "dismissed"): Promise<boolean>;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  busy: boolean;
  cancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const visibleNow = presentation.state === "active" || presentation.state === "visible";
  const shown = useRef(visibleNow);
  if (visibleNow) shown.current = true;
  const active = !run.outcome;
  const cancelLabel = run.initialCount === 0 ? "Cancel search" : "Cancel refresh";
  const hasError = refreshHasError(run);
  useRefreshResultView(presentation.autoDismiss && presentation.state === "visible", () =>
    acknowledge("viewed"),
  );
  // Keep a result already being read until close; explicit dismissal still wins.
  if (presentation.state === "dismissed" || (!visibleNow && !shown.current)) return null;
  const text = { fontSize: 12, lineHeight: 17, color: theme.colors.foregroundMuted };
  const title = (
    <Text style={{ ...text, color: theme.colors.foreground, flexShrink: 1 }}>
      {refreshTitle(run)}
    </Text>
  );
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        marginBottom: 4,
        gap: 5,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {hasError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${refreshTitle(run)}. ${expanded ? "Hide" : "Show"} details`}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{
              flex: 1,
              minHeight: touch ? 44 : 24,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            }}
          >
            {title}
            <Icon
              name={expanded ? "ChevronUp" : "ChevronDown"}
              size={12}
              color={theme.colors.foregroundMuted}
            />
          </Pressable>
        ) : (
          <View style={{ flex: 1 }}>{title}</View>
        )}
        <MenuAction
          theme={theme}
          touch={touch}
          icon="X"
          label={active ? cancelLabel : "Dismiss refresh result"}
          tooltip={active ? cancelLabel : "Dismiss"}
          disabled={busy || dismissing || (!active && presentation.state === "active")}
          busy={busy || dismissing}
          onPress={() => {
            if (active) cancel();
            else {
              setDismissing(true);
              void acknowledge("dismissed").finally(() => setDismissing(false));
            }
          }}
        />
      </View>
      {hasError && expanded && (
        <View style={{ gap: 7, paddingBottom: 5 }}>
          <Text style={text}>{run.profileName}</Text>
          {run.reason && <Text style={text}>{run.reason}</Text>}
          {run.cleanupPending && <Text style={text}>Closing the refresh agent…</Text>}
          {run.changes.map((change) => (
            <View key={`${change.kind}:${change.key}`}>
              <Text style={{ ...text, color: theme.colors.foreground }}>
                {change.title} · {change.kind === "section" ? "section" : change.kind}
              </Text>
              <Text style={text}>{change.reason}</Text>
              {change.sources.length > 0 && (
                <Text style={text}>From: {change.sources.join(" · ")}</Text>
              )}
            </View>
          ))}
          {run.contextIssues.map((issue) => (
            <Text key={issue} style={text}>
              {issue}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
