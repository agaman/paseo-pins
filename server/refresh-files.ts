import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { activeRun } from "./refresh-mutations";
import type { PinStore } from "./store";

const relativePath = z.string().max(1024).default(".");
export const filesListInput = z.object({ path: relativePath }).strict();
export const filesReadInput = z
  .object({
    path: z.string().min(1).max(1024),
    startLine: z.number().int().min(1).max(262144).default(1),
    lineCount: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export const filesSearchInput = z
  .object({
    path: relativePath,
    query: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n\0]/.test(value), "Use a single-line literal."),
  })
  .strict();

const fileBytes = 256 * 1024;
const outputCharacters = 16000;
const excluded = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

/** Read-only, bounded inspection. Symlinks are deliberately not followed. */
export class RefreshFiles {
  private constructor(
    private root: string,
    private signal: AbortSignal,
    private deadline: number,
  ) {}

  static async create(root: string, signal = new AbortController().signal, deadline = Infinity) {
    const files = new RefreshFiles(await realpath(root), signal, deadline);
    files.checkActive();
    return files;
  }

  private checkActive() {
    if (this.signal.aborted || Date.now() >= this.deadline)
      throw new Error("Workspace inspection was canceled or reached its deadline.");
  }

  private async resolve(relative: string) {
    this.checkActive();
    if (path.isAbsolute(relative) || relative.includes("\\") || relative.includes("\0"))
      throw new Error("Use a relative workspace path.");
    const parts = relative.split("/").filter((part) => part && part !== ".");
    if (parts.some((part) => part === ".." || excluded.has(part)))
      throw new Error("Path traversal and dependency/build/metadata directories are excluded.");
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinks are not followed.");
    }
    const canonical = await realpath(current);
    const inside = path.relative(this.root, canonical);
    if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      throw new Error("Path is outside this workspace.");
    this.checkActive();
    return canonical;
  }

  async list(relative: string) {
    const directory = await opendir(await this.resolve(relative));
    const entries: { name: string; type: "directory" | "file" }[] = [];
    let visited = 0;
    let truncated = false;
    let skipped = 0;
    for await (const entry of directory) {
      this.checkActive();
      if (++visited > 1000 || entries.length >= 200) {
        truncated = true;
        break;
      }
      if (excluded.has(entry.name) || (!entry.isFile() && !entry.isDirectory())) {
        skipped++;
        continue;
      }
      entries.push({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { path: relative, entries, truncated, skipped };
  }

  private async text(relative: string) {
    const resolved = await this.resolve(relative);
    const before = await lstat(resolved);
    if (!before.isFile()) throw new Error("Only regular text files can be read.");
    if (before.size > fileBytes) throw new Error("File exceeds the 256 KiB inspection limit.");
    const file = await open(
      resolved,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await file.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        (await this.resolve(relative)) !== resolved
      )
        throw new Error("File changed during inspection; retry if still relevant.");
      // Read at most the limit plus one byte, even if the file grows while open.
      const buffer = Buffer.alloc(fileBytes + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        this.checkActive();
        const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
      }
      if (bytes > fileBytes) throw new Error("File exceeds the 256 KiB inspection limit.");
      const content = buffer.subarray(0, bytes);
      if (content.includes(0)) throw new Error("Binary files are not supported.");
      try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(content), bytes };
      } catch {
        throw new Error("File is not UTF-8 text.");
      }
    } finally {
      await file.close();
    }
  }

  async read(input: z.infer<typeof filesReadInput>) {
    const { text } = await this.text(input.path);
    const lines = text.split(/\r?\n/);
    let endLine = Math.min(lines.length, input.startLine - 1);
    let selected = "";
    let truncated = false;
    for (const line of lines.slice(input.startLine - 1, input.startLine + input.lineCount - 1)) {
      const next = `${endLine >= input.startLine ? "\n" : ""}${line}`;
      if (selected.length + next.length > outputCharacters) {
        truncated = true;
        // Keep complete lines when possible so nextLine can continue without gaps.
        if (endLine < input.startLine) {
          selected = line.slice(0, outputCharacters);
          endLine++;
        }
        break;
      }
      selected += next;
      endLine++;
    }
    return {
      path: input.path,
      startLine: input.startLine,
      endLine,
      text: selected,
      truncated,
      nextLine: endLine < lines.length ? endLine + 1 : null,
    };
  }

  async search(input: z.infer<typeof filesSearchInput>) {
    const root = await this.resolve(input.path);
    const matches: { path: string; line: number; text: string }[] = [];
    const pending = [{ path: input.path, depth: 0 }];
    let scannedFiles = 0;
    let scannedBytes = 0;
    let skipped = 0;
    let truncated = false;
    let visited = 0;
    while (pending.length) {
      this.checkActive();
      if (
        ++visited > 1000 ||
        scannedFiles >= 200 ||
        scannedBytes >= 2 * 1024 * 1024 ||
        matches.length >= 30
      ) {
        truncated = true;
        break;
      }
      const entry = pending.pop();
      if (!entry) break;
      try {
        const info = await lstat(entry.path === input.path ? root : await this.resolve(entry.path));
        if (info.isDirectory()) {
          if (entry.depth >= 6) {
            truncated = true;
            continue;
          }
          const listing = await this.list(entry.path);
          truncated ||= listing.truncated;
          skipped += listing.skipped;
          for (const child of listing.entries.reverse()) {
            if (pending.length >= 1000) {
              truncated = true;
              break;
            }
            pending.push({ path: path.posix.join(entry.path, child.name), depth: entry.depth + 1 });
          }
          continue;
        }
        scannedFiles++;
        const content = await this.text(entry.path);
        scannedBytes += content.bytes;
        const lines = content.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const index = lines[i].indexOf(input.query);
          if (index < 0) continue;
          if (matches.length >= 30) {
            truncated = true;
            break;
          }
          const start = Math.max(0, index - 120);
          matches.push({ path: entry.path, line: i + 1, text: lines[i].slice(start, start + 500) });
        }
      } catch {
        this.checkActive();
        skipped++;
      }
    }
    return { matches, scannedFiles, skipped, truncated };
  }
}

export async function refreshFiles(store: PinStore, context: AgentToolContext) {
  const workspaceId = context.agent.workspaceId;
  if (!workspaceId) throw new Error("Refresh requires its original workspace.");
  const run = activeRun(await store.document(workspaceId), context.agent.id);
  const workspace = await context.paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace || workspace.id !== workspaceId) throw new Error("Workspace is unavailable.");
  activeRun(await store.document(workspaceId), context.agent.id);
  return RefreshFiles.create(
    workspace.workspaceDirectory,
    context.signal,
    Date.parse(run.deadline),
  );
}
