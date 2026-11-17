import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PinsButtonIcon } from "../../client/menu/pins-button-icon";
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
      statusDanger: "#f18a8a",
    }
  : {
      surface0: "#ffffff",
      surface1: "#fafafa",
      surface2: "#f4f4f5",
      border: "#e4e4e7",
      foreground: "#1a1a1e",
      foregroundMuted: "#71717a",
      accent: "#207a50",
      statusDanger: "#c93636",
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
        padding: chat ? 32 : 16,
        position: "relative",
        overflow: "hidden",
        width: chat ? 700 : compact ? 390 : 360,
        boxSizing: "border-box",
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      }}
    >
      {chat ? (
        <>
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
          <div style={{ marginTop: 28 }}>
            <Composer />
          </div>
        </>
      ) : compact ? (
        <>
          <Conversation />
          <div style={{ height: 420 }} />
          <Composer />
          <div style={{ position: "absolute", inset: 0, background: "#0006" }} />
          <section
            data-testid="pins-sheet"
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: menuSurface,
              borderRadius: "16px 16px 0 0",
              overflow: "hidden",
            }}
          >
            <div style={{ background: colors.surface0, padding: "10px 0" }}>
              <div
                style={{
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  background: colors.foregroundMuted,
                  margin: "auto",
                }}
              />
            </div>
            <div style={{ padding: "4px 12px 12px", fontSize: 14 }}>Pins</div>
            <MenuContent />
          </section>
        </>
      ) : (
        <>
          <Conversation />
          <section
            data-testid="pins-popover"
            style={{
              width: 280,
              marginLeft: "auto",
              marginTop: 24,
              marginBottom: 12,
              background: menuSurface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              overflow: "hidden",
              boxShadow: dark ? "0 4px 8px #0003" : "0 4px 16px #0000000a",
            }}
          >
            <div style={{ maxHeight: 440, overflowY: "auto", padding: "4px 0" }}>
              <MenuContent />
            </div>
          </section>
          <Composer />
        </>
      )}
    </main>
  </QueryClientProvider>,
);

// Paseo owns this surrounding chrome. Keep fixtures aligned with its composer pill styles;
// the plugin menu, icon/count, and summary above are the actual runtime components.
function Conversation() {
  return (
    <div style={{ fontSize: 14, lineHeight: "22px", padding: "8px 0" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>The onboarding update is ready.</div>
      <div style={{ color: colors.foregroundMuted }}>
        I added the preview, pull request, and accessibility report to Pins.
      </div>
    </div>
  );
}

function MenuContent() {
  return (
    <div style={{ padding: 12 }}>
      <PinsPopover
        workspaceId="sample"
        host={host}
        theme={theme}
        layout={layout}
        close={() => {}}
        openSettings={() => {}}
      />
    </div>
  );
}

function Composer() {
  const [count, setCount] = useState(0);
  const pill = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
    padding: "4px 12px",
    borderRadius: 16,
    border: `1px solid ${colors.border}`,
    background: colors.surface1,
    fontSize: 12,
    color: colors.foregroundMuted,
  };
  return (
    <div data-testid="composer-context">
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: compact ? 8 : 10 }}
      >
        <div style={pill}>2 subagents</div>
        <div
          data-testid="pins-composer-pill"
          style={{ ...pill, background: chat ? colors.surface1 : colors.surface2 }}
        >
          <PinsButtonIcon
            host={host}
            workspaceId="sample"
            theme={theme}
            layout={layout}
            size={14}
            color={colors.foregroundMuted}
            onCount={setCount}
          />
          Pins{count ? ` (${count})` : ""}
        </div>
      </div>
      <div
        data-testid="chat-composer"
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          background: colors.surface1,
          padding: 12,
        }}
      >
        <div style={{ color: colors.foregroundMuted, fontSize: 13, marginBottom: 30 }}>
          Message, @files, /commands
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: colors.foregroundMuted,
            fontSize: 12,
          }}
        >
          <Icon name="Plus" size={16} color={colors.foregroundMuted} />
          <span>Agent profile</span>
          <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
          <div style={{ marginLeft: "auto" }}>
            <Icon name="Mic" size={16} color={colors.foregroundMuted} />
          </div>
        </div>
      </div>
    </div>
  );
}
