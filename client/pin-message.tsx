import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";

export function PinMessage({
  message,
  theme,
}: {
  message: string;
  theme: PluginButtonContentProps["theme"];
}) {
  return (
    <View
      testID="pin-update-message"
      style={{
        marginTop: 4,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.accent,
        paddingLeft: 7,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        {message}
      </Text>
    </View>
  );
}
