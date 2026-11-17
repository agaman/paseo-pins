import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const manifestSchema = z.object({
  id: z.string().min(1),
  requirements: z.object({ paseo: z.string().min(1) }),
  icon: z.string().min(1).optional(),
  media: z.array(z.string().min(1)).optional(),
});

/** Check the files delivered by a Git install, without loading plugin code. */
export function checkDistribution(root: string) {
  root = path.resolve(root);
  const tracked = new Map(
    execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [metadata, ...name] = entry.split("\t");
        return [name.join("\t"), metadata.split(" ")[0]];
      }),
  );
  const checked = new Set<string>();
  function requireFile(file: string) {
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || path.isAbsolute(relative))
      throw new Error(`Distribution file is outside the plugin: ${file}`);
    if (!tracked.has(relative))
      throw new Error(`Distribution file is not tracked in Git: ${relative}`);
    if (!["100644", "100755"].includes(tracked.get(relative) ?? ""))
      throw new Error(`Distribution file must be a regular file: ${relative}`);
    const absolute = path.join(root, relative);
    // Check every component so a replaced directory cannot redirect reads outside the checkout.
    let current = root;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Distribution path contains a symlink: ${relative}`);
    }
    if (!lstatSync(absolute).isFile()) throw new Error(`Distribution file is missing: ${relative}`);
    checked.add(relative);
    return absolute;
  }

  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(requireFile("paseo-plugin.json"), "utf8")),
  );
  for (const file of ["package.json", "LICENSE", "README.md"]) requireFile(file);
  if (manifest.icon) requireFile(manifest.icon);
  for (const file of manifest.media ?? []) {
    if (file.startsWith("https://")) continue;
    requireFile(file);
  }

  const entries = [
    "index.client.ts",
    "index.client.tsx",
    "index.server.ts",
    "index.server.tsx",
  ].filter((file) => tracked.has(file));
  if (!entries.length) throw new Error("Distribution has no tracked client or server entry.");
  const pending = [...entries];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const absolute = requireFile(file);
    if (file.endsWith(".json")) continue;
    const source = readFileSync(absolute, "utf8");
    // Preserve value imports while erasing explicit type-only imports.
    const runtimeSource = /\.d\.[cm]?ts$/.test(file)
      ? ""
      : ts.transpileModule(source, {
          fileName: absolute,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            jsx: ts.JsxEmit.Preserve,
            verbatimModuleSyntax: true,
          },
        }).outputText;
    const runtimeImports = new Set(
      ts.preProcessFile(runtimeSource, true, true).importedFiles.map(({ fileName }) => fileName),
    );
    for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const resolved = ts.resolveModuleName(
        specifier,
        absolute,
        {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          allowJs: true,
          resolveJsonModule: true,
        },
        runtimeImports.has(specifier)
          ? {
              ...ts.sys,
              fileExists: (candidate) =>
                !/\.d\.[cm]?ts$/.test(candidate) && ts.sys.fileExists(candidate),
            }
          : ts.sys,
      ).resolvedModule;
      if (!resolved) throw new Error(`Missing local import ${specifier} in ${file}`);
      const dependency = path.relative(root, resolved.resolvedFileName);
      requireFile(dependency);
      pending.push(dependency);
    }
  }
  return checked.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = checkDistribution(fileURLToPath(new URL("../../", import.meta.url)));
    console.log(
      `Git distribution checked: ${count} tracked files, including local imports and media.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
