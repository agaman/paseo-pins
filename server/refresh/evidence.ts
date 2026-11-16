import type { Paseo } from "./context";

type Timeline = ReturnType<Paseo["agents"]["ref"]>["timeline"];
export type EvidencePage = Awaited<ReturnType<Timeline["refetch"]>>;
type EvidenceEntry = EvidencePage["entries"][number];
type ResourceMention = {
  sourceId: string;
  conversation: string;
  timestamp: string | null;
  offset: number;
  excerpt: string;
};
export type ResourceEntry = { url: string; mentions: ResourceMention[] };

export function evidenceText(entry: EvidenceEntry): string | null {
  const item = entry.item;
  if (item.type === "user_message" || item.type === "assistant_message") return item.text;
  if (item.type !== "tool_call") return null;
  const detail = item.detail;
  const output =
    detail.type === "shell"
      ? detail.output
      : detail.type === "fetch"
        ? `${detail.url}\n${detail.result ?? ""}`
        : detail.type === "search"
          ? detail.content
          : detail.type === "plain_text"
            ? detail.text
            : undefined;
  return output ? `${item.name} (${item.status}):\n${output}` : null;
}

export function indexResources(
  index: Map<string, ResourceEntry>,
  text: string,
  mention: Omit<ResourceMention, "offset" | "excerpt">,
) {
  let clipped = false;
  let found = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    if (++found > 100) {
      clipped = true;
      break;
    }
    let raw = match[0].replace(/[.,;]+$/, "");
    while (raw.endsWith(")") && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0))
      raw = raw.slice(0, -1);
    if (raw.length > 2048) {
      clipped = true;
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.username || url.password) continue;
    const key = url.href;
    const current = index.get(key);
    if (!current && index.size >= 100) {
      clipped = true;
      continue;
    }
    const resource = current ?? { url: key, mentions: [] };
    const offset = match.index ?? 0;
    if (
      resource.mentions.length < 3 &&
      !resource.mentions.some((m) => m.sourceId === mention.sourceId)
    ) {
      resource.mentions.push({
        ...mention,
        offset,
        excerpt: text
          .slice(Math.max(0, offset - 70), offset + raw.length + 90)
          .slice(0, 260)
          .replace(/\s+/g, " "),
      });
    }
    index.set(key, resource);
  }
  return clipped;
}
