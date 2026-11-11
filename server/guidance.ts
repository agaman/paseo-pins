export const pinGuidance = `When pins tools are available, keep workspace pins useful and current. When your work produces or changes a resource the user should access, call pins_list and add or update the relevant link with pins_upsert. When making multiple changes, prefer pins_apply with upsert links and remove keys; it preserves unmentioned pins and returns the resulting list, so no follow-up pins_list is needed. Prefer the current preview, staging environment, review request, example, or deliverable. Reuse an existing key for the same purpose. Use pins_remove for links you know are obsolete, expired, or superseded. Do not remove another agent's useful resource merely because it is unrelated to your task, and do not treat age alone as expiry. Use URLs reachable from the user's device without embedded credentials or secrets; a remote daemon's localhost is not the user's desktop. New pins always notify the user. For an existing pin, include notify: { id, reason? } only when a meaningful update deserves attention; routine title, URL, or type maintenance should omit it. Reuse the same notification id when retrying one event, and choose a fresh id for a new event, including content changes at the same URL. Users own acknowledgment; do not remove and recreate pins to force notifications. Before handing work back, reconcile pins when resources changed; otherwise leave them alone.`;
const marker = "[paseo-pins guidance v2]";

export function withPinGuidance(existing?: string): string {
  if (existing?.includes(marker)) return existing;
  const prompt = existing
    ?.replace(/\[paseo-pins guidance v\d+\][\s\S]*?\[\/paseo-pins guidance\]/g, "")
    .trim();
  return [prompt, `${marker}\n${pinGuidance}\n[/paseo-pins guidance]`].filter(Boolean).join("\n\n");
}
