import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { PinsPopover } from "../../client/menu/pins-popover";
import { TurnSummary } from "../../client/summaries/turn-summary";
import { Icon } from "./fixture";

const params = new URLSearchParams(location.search);
const dark = params.has("dark");
const compact = params.has("compact");
const chat = params.has("chat");
const colors = dark
  ? {
      surface0: "#18181b",
      surface1: "#202023",
      surface2: "#27272a",
      border: "#303033",
      foreground: "#fafafa",
      foregroundMuted: "#a1a1aa",
      accent: "#4ade80",
    }
  : {
      surface0: "#ffffff",
      surface1: "#fafafa",
      surface2: "#f4f4f5",
      border: "#e4e4e7",
      foreground: "#1a1a1e",
      foregroundMuted: "#71717a",
      accent: "#207a50",
    };
const theme = { colors };
const host = { id: "listing-preview" };
const layout = { compact, platform: "web" };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const menuSurface = compact ? colors.surface2 : colors.surface1;
document.body.style.background = colors.surface0;

createRoot(document.getElementById("app")).render(
  <QueryClientProvider client={client}>
    <main
      style={{
        color: colors.foreground,
        padding: chat ? 32 : compact ? 16 : 40,
        width: chat ? 700 : compact ? 390 : 360,
        boxSizing: "border-box",
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      }}
    >
      {chat ? (
        <TurnSummary
          host={host}
          theme={theme}
          layout={layout}
          agentId="sample-agent"
          timestamp={new Date("2026-11-16T12:00:00Z")}
          item={{
            type: "plugin",
            kind: "turn-summary",
            version: 1,
            data: { workspaceId: "sample", summaryId: "a".repeat(64) },
          }}
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 10px",
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 13,
                color: colors.foregroundMuted,
                background: colors.surface1,
              }}
            >
              <Icon name="Pin" size={16} color={colors.foregroundMuted} />
              Pins (2)
              <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
            </div>
          </div>
          <section
            style={{
              width: "100%",
              background: menuSurface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: dark ? "none" : "0 8px 28px #00000008",
            }}
          >
            <div style={{ padding: "16px 12px" }}>
              <PinsPopover
                workspaceId="sample"
                host={host}
                theme={theme}
                layout={layout}
                close={() => {}}
                openSettings={() => {}}
              />
            </div>
          </section>
        </>
      )}
    </main>
  </QueryClientProvider>,
);
