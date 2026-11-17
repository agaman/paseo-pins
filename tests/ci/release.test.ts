import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { release } from "../../tools/release";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "pins-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "checkout");
  const remote = path.join(directory, "origin.git");
  await mkdir(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.test");
  git("config", "commit.gpgSign", "false");
  git("config", "tag.gpgSign", "false");
  git("config", "core.hooksPath", path.join(directory, "no-hooks"));
  const write = (file: string, content: string) => writeFile(path.join(root, file), content);
  const version = async (value: string) => {
    await write("package.json", JSON.stringify({ version: value }));
    await write(
      "package-lock.json",
      JSON.stringify({ version: value, packages: { "": { version: value } } }),
    );
  };
  const commit = () => {
    git("add", "--all");
    git("commit", "-m", "Test release");
  };
  await version("0.1.0");
  commit();
  git("init", "--bare", "--initial-branch=main", remote);
  git("remote", "add", "origin", remote);
  git("push", "--set-upstream", "origin", "main");
  return { root, remote, git, write, version, commit };
}

test("release dry run leaves local and remote tags unchanged", async (t) => {
  const { root, git } = await fixture(t);
  assert.match(release(root, { dryRun: true }), /Would create and push v0.1.0/);
  assert.equal(git("tag", "--list"), "");
  assert.equal(git("ls-remote", "--tags", "origin"), "");
  assert.equal(git("status", "--porcelain"), "");
});

test("release pushes an annotated version tag and can be safely repeated", async (t) => {
  const { root, git } = await fixture(t);
  assert.match(release(root), /Pushed v0.1.0/);
  assert.equal(git("cat-file", "-t", "refs/tags/v0.1.0"), "tag");
  assert.equal(git("rev-parse", "v0.1.0^{commit}"), git("rev-parse", "HEAD"));
  assert.match(
    git("ls-remote", "origin", "refs/tags/v0.1.0^{}"),
    new RegExp(git("rev-parse", "HEAD")),
  );
  assert.match(release(root), /already pushed/);
});

test("release retries an existing local tag after a rejected push", async (t) => {
  const { root, remote, git } = await fixture(t);
  const hook = path.join(remote, "hooks/pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.throws(() => release(root), /hook declined/);
  const original = git("rev-parse", "refs/tags/v0.1.0");
  await rm(hook);
  assert.match(release(root), /Pushed v0.1.0/);
  assert.equal(git("rev-parse", "refs/tags/v0.1.0"), original);
});

test("release pushes only its version tag even when push.followTags is enabled", async (t) => {
  const { root, git } = await fixture(t);
  git("config", "push.followTags", "true");
  git("tag", "-a", "v0.0.9", "-m", "Unreleased local tag");
  release(root);
  assert.equal(git("ls-remote", "origin", "refs/tags/v0.0.9"), "");
  assert.match(git("ls-remote", "origin", "refs/tags/v0.1.0"), /refs\/tags\/v0.1.0/);
});

test("release requires a clean main matching the remote", async (t) => {
  const { root, git, write, commit } = await fixture(t);
  git("switch", "-c", "feature");
  assert.throws(() => release(root), /Release from main/);
  git("switch", "main");
  await write("untracked.txt", "unfinished");
  assert.throws(() => release(root), /working tree changes/);
  commit();
  assert.throws(() => release(root), /must match origin/);
  git("push", "origin", "main");
  assert.match(release(root, { dryRun: true }), /Would create and push/);
});

test("release rejects invalid versions and mismatched lock metadata", async (t) => {
  const { root, version, write } = await fixture(t);
  for (const value of ["01.2.3", "1.2", "1.2.3-beta.1", "../unsafe"]) {
    await version(value);
    assert.throws(() => release(root), /stable version/);
  }
  await version("0.1.0");
  await write("package-lock.json", JSON.stringify({ version: "0.2.0" }));
  assert.throws(() => release(root), /versions must match/);
});

test("release never replaces lightweight or conflicting tags", async (t) => {
  const { root, git, write, commit } = await fixture(t);
  git("tag", "v0.1.0");
  assert.throws(() => release(root), /annotated tag/);
  git("tag", "-d", "v0.1.0");
  release(root);
  await write("new.txt", "new commit, same version");
  commit();
  git("push", "origin", "main");
  assert.throws(() => release(root), /existing tags are never replaced/);
  git("tag", "-d", "v0.1.0");
  assert.throws(() => release(root), /already exists on origin/);
});

test("CI validates matching annotated tags on main, including detached checkouts", async (t) => {
  const { root, git, write, commit } = await fixture(t);
  release(root);
  git("checkout", "--detach", "v0.1.0");
  assert.match(release(root, { checkTag: "v0.1.0" }), /Validated v0.1.0/);
  assert.throws(() => release(root, { checkTag: "v0.2.0" }), /must match package version/);
  git("switch", "-c", "unmerged");
  await write("new.txt", "not on main");
  commit();
  git("tag", "-d", "v0.1.0");
  git("tag", "-a", "v0.1.0", "-m", "Invalid release");
  assert.throws(() => release(root, { checkTag: "v0.1.0" }), /must be on origin\/main/);
});
