import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { filesReadInput, filesSearchInput, RefreshFiles } from "../../server/refresh/files";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(path.join(tmpdir(), "pins-files-"));
  const root = path.join(base, "workspace");
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root, files: await RefreshFiles.create(root) };
}

test("lists, literally searches, and pages text without changing files", async (t) => {
  const { root, files } = await fixture(t);
  const original = "# Work\n\npreview: https://preview.example/[active]\nlast line";
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "work.md"), original);
  assert.deepEqual((await files.list(".")).entries, [{ name: "docs", type: "directory" }]);
  const hits = await files.search(filesSearchInput.parse({ query: "[active]" }));
  assert.deepEqual(hits.matches, [
    { path: "docs/work.md", line: 3, text: original.split("\n")[2] },
  ]);
  const page = await files.read(filesReadInput.parse({ path: "docs/work.md", lineCount: 2 }));
  assert.equal(page.text, "# Work\n");
  assert.equal(page.nextLine, 3);
  const next = await files.read(filesReadInput.parse({ path: "docs/work.md", startLine: 3 }));
  assert.equal(next.text, original.split("\n").slice(2).join("\n"));
  assert.equal(next.nextLine, null);
  assert.equal(await readFile(path.join(root, "docs", "work.md"), "utf8"), original);
});

test("rejects traversal, absolute paths, and symlinks to files or directories", async (t) => {
  const { base, root, files } = await fixture(t);
  await writeFile(path.join(base, "outside.txt"), "outside-private-content");
  await writeFile(path.join(root, "inside.txt"), "inside");
  await symlink(path.join(base, "outside.txt"), path.join(root, "external"));
  await symlink(base, path.join(root, "external-dir"));
  await symlink("inside.txt", path.join(root, "internal"));
  for (const candidate of [
    "../outside.txt",
    path.join(base, "outside.txt"),
    "external",
    "external-dir/outside.txt",
    "internal",
    "a/../../outside.txt",
    "..\\outside.txt",
  ]) {
    await assert.rejects(files.read(filesReadInput.parse({ path: candidate })));
  }
  await assert.rejects(files.list("external-dir"), /Symlinks/);
  await assert.rejects(files.search(filesSearchInput.parse({ path: "../", query: "outside" })));
  const result = await files.search(filesSearchInput.parse({ query: "outside" }));
  assert.deepEqual(result.matches, []);
  assert.equal(result.skipped, 3);
});

test("excludes build/dependency/metadata directories, binary and oversized files", async (t) => {
  const { root, files } = await fixture(t);
  for (const dir of [".git", "node_modules", "dist"]) {
    await mkdir(path.join(root, dir));
    await writeFile(path.join(root, dir, "file"), "needle");
    await assert.rejects(files.read(filesReadInput.parse({ path: `${dir}/file` })), /excluded/);
  }
  await writeFile(path.join(root, "binary"), Buffer.from([0, 65]));
  await writeFile(path.join(root, "non-utf8"), Buffer.from([255]));
  await writeFile(path.join(root, "large"), "x".repeat(256 * 1024 + 1));
  await assert.rejects(files.read(filesReadInput.parse({ path: "binary" })), /Binary/);
  await assert.rejects(files.read(filesReadInput.parse({ path: "non-utf8" })), /UTF-8/);
  await assert.rejects(files.read(filesReadInput.parse({ path: "large" })), /limit/);
  await assert.rejects(files.read(filesReadInput.parse({ path: "." })), /regular/);
  const result = await files.search(filesSearchInput.parse({ query: "needle" }));
  assert.equal(result.matches.length, 0);
  assert.equal(result.skipped, 6);
});

test("limits output and search results and preserves whole-line continuation", async (t) => {
  const { root, files } = await fixture(t);
  await writeFile(path.join(root, "many"), `${"needle".repeat(200)}\n`.repeat(40));
  const page = await files.read(filesReadInput.parse({ path: "many" }));
  assert.ok(page.text.length <= 16000);
  assert.equal(page.truncated, true);
  assert.equal(page.nextLine, page.text.split("\n").length + 1);
  const result = await files.search(filesSearchInput.parse({ query: "needle" }));
  assert.equal(result.matches.length, 30);
  assert.equal(result.truncated, true);
  assert.ok(result.matches.every((match) => match.text.length <= 500));
  await writeFile(path.join(root, "long-line"), "x".repeat(20000));
  const long = await files.read(filesReadInput.parse({ path: "long-line" }));
  assert.equal(long.text.length, 16000);
  assert.equal(long.truncated, true);
});

test("bounds directory scans and respects cancellation and deadlines", async (t) => {
  const { root, files } = await fixture(t);
  await Promise.all(
    Array.from({ length: 201 }, (_, i) => writeFile(path.join(root, `${i}.txt`), "x")),
  );
  const listing = await files.list(".");
  assert.equal(listing.entries.length, 200);
  assert.equal(listing.truncated, true);
  const controller = new AbortController();
  const canceled = await RefreshFiles.create(root, controller.signal);
  controller.abort();
  await assert.rejects(canceled.list("."), /canceled/);
  await assert.rejects(RefreshFiles.create(root, undefined, Date.now() - 1), /deadline/);
  assert.equal(filesReadInput.safeParse({ path: "a", lineCount: 10000 }).success, false);
  assert.equal(filesSearchInput.safeParse({ query: "x\ny" }).success, false);
  assert.equal(filesSearchInput.safeParse({ query: "x", workspaceId: "other" }).success, false);
});
