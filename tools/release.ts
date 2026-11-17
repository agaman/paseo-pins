import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Validate and tag a Git release; --check-tag is used by the read-only CI job. */
export function release(root: string, options: { dryRun?: boolean; checkTag?: string } = {}) {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const { version } = readJson("package.json");
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("package.json must have a stable version such as 0.1.0.");
  const lock = readJson("package-lock.json");
  if (lock.version !== version || lock.packages?.[""]?.version !== version)
    throw new Error("package.json and package-lock.json versions must match.");
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  const head = git("rev-parse", "HEAD");
  const localTag = git("tag", "--list", tag);
  const validateLocalTag = () => {
    if (git("cat-file", "-t", ref) !== "tag" || git("rev-parse", `${ref}^{commit}`) !== head)
      throw new Error(
        `${tag} must be an annotated tag pointing to HEAD; existing tags are never replaced.`,
      );
  };

  if (options.checkTag !== undefined) {
    if (options.checkTag !== tag) throw new Error(`Release tag must match package version: ${tag}`);
    if (!localTag) throw new Error(`Missing release tag ${tag}.`);
    validateLocalTag();
    try {
      git("merge-base", "--is-ancestor", head, "refs/remotes/origin/main");
    } catch {
      throw new Error("Release commit must be on origin/main.");
    }
    return `Validated ${tag} at ${head}.`;
  }

  if (git("branch", "--show-current") !== "main") throw new Error("Release from main.");
  if (git("status", "--porcelain", "--untracked-files=all"))
    throw new Error("Commit or remove working tree changes before releasing.");
  const remoteRefs = new Map(
    git("ls-remote", "origin", "refs/heads/main", ref, `${ref}^{}`)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split("\t");
        return [name, sha];
      }),
  );
  if (remoteRefs.get("refs/heads/main") !== head)
    throw new Error("Local main must match origin's current main. Pull or push before releasing.");
  if (localTag) validateLocalTag();
  if (remoteRefs.has(ref)) {
    if (remoteRefs.get(`${ref}^{}`) !== head)
      throw new Error(
        `${tag} already exists on origin with a different commit or is not annotated.`,
      );
    return `${tag} is already pushed. Check or rerun its Release workflow in GitHub Actions.`;
  }
  if (options.dryRun)
    return `Would ${localTag ? "push" : "create and push"} ${tag} at ${head} to origin.`;
  if (!localTag) git("tag", "-a", tag, "-m", `Release ${tag}`, head);
  // Keep the local tag if the push fails, so the same command can retry safely.
  git("push", "--no-follow-tags", "origin", `${ref}:${ref}`);
  return `Pushed ${tag}. GitHub Actions will validate it, run CI, and publish the release.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 0 &&
      !(args.length === 1 && args[0] === "--dry-run") &&
      !(args.length === 2 && args[0] === "--check-tag")
    )
      throw new Error("Usage: npm run release -- [--dry-run | --check-tag vX.Y.Z]");
    console.log(
      release(fileURLToPath(new URL("../", import.meta.url)), {
        dryRun: args[0] === "--dry-run",
        checkTag: args[0] === "--check-tag" ? args[1] : undefined,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
