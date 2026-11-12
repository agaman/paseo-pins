import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type RefreshView, refreshHasError, refreshTitle } from "../shared/refresh";
import { MenuAction } from "./menu-action";

const dismissed = new Set<string>();
export function RefreshResult({
  run,
  hostId,
  workspaceId,
  theme,
  touch,
  busy,
  cancel,
}: {
  run: RefreshView;
  hostId: string;
  workspaceId: string;
  theme: PluginButtonContentProps["theme"];
  touch: boolean;
  busy: boolean;
  cancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const key = `${hostId}:${workspaceId}:${run.id}`;
  const active = !run.outcome;
  const hasError = refreshHasError(run);
  if (!active && (hidden || dismissed.has(key))) return null;
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
          label={active ? "Cancel refresh" : "Dismiss refresh result"}
          tooltip={active ? "Cancel refresh" : "Dismiss"}
          disabled={busy}
          busy={busy}
          onPress={() => {
            if (active) cancel();
            else {
              dismissed.add(key);
              setHidden(true);
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
