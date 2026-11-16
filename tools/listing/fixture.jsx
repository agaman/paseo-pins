import { icons } from "lucide-react";

const timestamp = "2026-11-16T12:00:00.000Z";
const definitions = [
  [
    "preview",
    "Development preview",
    "app",
    "https://preview.example.com/onboarding",
    "work",
    "The new onboarding flow is ready to review.",
  ],
  [
    "review",
    "Onboarding pull request",
    "review",
    "https://github.com/example/project/pull/42",
    "work",
    null,
  ],
  [
    "report",
    "Accessibility report",
    "artifact",
    "https://reports.example.com/onboarding",
    "reference",
    "Keyboard and screen-reader checks are ready.",
  ],
  ["handbook", "Project handbook", "docs", "https://docs.example.com", "reference", null],
];
let pins = definitions.map(([key, title, type, url, section, reason], index) => ({
  key,
  title,
  type,
  url,
  section,
  instanceId: `10000000-0000-4000-8000-00000000000${index}`,
  source: key === "handbook" ? "repo" : "agent",
  kept: key === "review",
  createdAt: timestamp,
  updatedAt: timestamp,
  attention: reason
    ? { token: `20000000-0000-4000-8000-00000000000${index}`, notifiedAt: timestamp, reason }
    : null,
  readAttentionToken: null,
  consumedNotificationIds: [],
}));
const sections = [
  { key: "work", title: "In progress", source: "agent" },
  { key: "reference", title: "Reference", source: "repo" },
];
const snapshot = () => ({
  pins,
  sections,
  config: { loaded: true, error: null },
  unreadCount: pins.filter((p) => p.attention && p.attention.token !== p.readAttentionToken).length,
});
const entries = pins
  .filter((p) => p.key !== "handbook")
  .map((p) => ({
    key: p.key,
    instanceId: p.instanceId,
    title: p.title,
    url: p.url,
    type: p.type,
    kind: p.attention ? "updated" : "added",
    attentionToken: p.attention?.token ?? null,
    reason: p.attention?.reason ?? null,
  }));
const handlers = {
  "pins.list": async () => snapshot(),
  "pins.refresh.status": async () => ({ run: null, configured: true, presentation: null }),
  "pins.summary.read": async ({ offset, limit }) => ({
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
    unreadCount: snapshot().unreadCount,
    startedAt: timestamp,
    endedAt: timestamp,
    outcome: "completed",
    recovered: false,
  }),
  "pins.acknowledge": async ({ entries: acknowledged }) => {
    pins = pins.map((p) =>
      acknowledged.some((e) => e.key === p.key && e.attentionToken === p.attention?.token)
        ? { ...p, readAttentionToken: p.attention.token }
        : p,
    );
    return { ...snapshot(), results: [] };
  },
};
export const useRpc = (rpc) => {
  if (!handlers[rpc.name])
    return async () => {
      throw Error(`Unsupported capture action: ${rpc.name}`);
    };
  return handlers[rpc.name];
};
export const openExternalUrl = async () => {};
export const defineRpc = (value) => value;
export const defineSettings = (value) => value;
export function Icon({ name, icon, size = 16, color }) {
  if (icon?.svg)
    return (
      <img
        alt=""
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
        src={`data:image/svg+xml,${encodeURIComponent(icon.svg.replaceAll("currentColor", color))}`}
      />
    );
  const Component = icons[name || icon];
  if (!Component) throw Error(`Missing capture icon: ${name || icon}`);
  return <Component size={size} color={color} strokeWidth={1.5} style={{ flexShrink: 0 }} />;
}
