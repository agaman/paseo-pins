import type { PluginHookEvents } from "@getpaseo/plugin/server";
import { z } from "zod";
import { refreshToolNames } from "./tools";

export type RefreshPermission = PluginHookEvents["agent.permission.before"]["request"];
const confirmationForm = z
  .object({
    mode: z.enum(["form", "openai/form"]),
    requestedSchema: z
      .object({ type: z.literal("object"), properties: z.object({}).strict() })
      .strict(),
    url: z.null().optional(),
  })
  .strict();

export function isRefreshToolPermission(request: RefreshPermission) {
  if (request.kind !== "tool") return false;
  return Object.values(refreshToolNames).some((name) => {
    if (request.name === `paseo.${name}` || request.name === `mcp__paseo__${name}`) return true;
    // Paseo 0.15.4 surfaces Codex MCP confirmation as an empty form, rather
    // than a named tool permission. Match the exact server/tool confirmation;
    // never approve arbitrary elicitation questions or grant server-wide access.
    return (
      request.name === "CodexMcpElicitation" &&
      request.metadata?.serverName === "paseo" &&
      request.description === `Allow the paseo MCP server to run tool "${name}"?` &&
      confirmationForm.safeParse(request.input).success
    );
  });
}
