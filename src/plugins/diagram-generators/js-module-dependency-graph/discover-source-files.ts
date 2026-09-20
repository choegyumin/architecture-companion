import { lstat, readdir, realpath } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import micromatch from "micromatch";

import { isPathInside, toPosixPath } from "@/shared/node/path";

export type DiscoveredSourceFile = Readonly<{
  absolutePath: string;
  relativePath: string;
}>;

const sourceExtensions = [".tsx", ".mts", ".cts", ".ts", ".jsx", ".mjs", ".cjs", ".js"] as const;
const sourceExtensionSet: ReadonlySet<string> = new Set(sourceExtensions);
const sourceExtensionGlob = sourceExtensions.map((extension) => extension.slice(1)).join(",");
const defaultExcludeGlobs = [
  "**/{__tests__,test,tests}/**",
  `**/*.{test,spec}.{${sourceExtensionGlob}}`,
  "**/*.{test,spec}.d.{ts,mts,cts}",
  "**/{.next,.nuxt,.svelte-kit,build,coverage,dist,node_modules,out}/**",
  "**/{__generated__,generated}/**",
  `**/*.{gen,generated}.{${sourceExtensionGlob}}`,
  "**/*.{gen,generated}.d.{ts,mts,cts}",
] as const;

function isExcluded(relativePath: string, excludeGlobs: readonly string[]): boolean {
  return micromatch.isMatch(relativePath, excludeGlobs, { dot: true });
}

function isDirectoryExcluded(relativeDirectoryPath: string, excludeGlobs: readonly string[]): boolean {
  if (!relativeDirectoryPath) return false;
  const probes = sourceExtensions.flatMap((extension) => [
    `${relativeDirectoryPath}/__architecture_companion_probe__${extension}`,
    `${relativeDirectoryPath}/nested/__architecture_companion_probe__${extension}`,
  ]);
  return probes.every((probe) => isExcluded(probe, excludeGlobs));
}

export async function resolveScopePath(scopePath: string): Promise<string> {
  const resolvedPath = await realpath(resolve(scopePath));
  if (!(await lstat(resolvedPath)).isDirectory()) throw new Error(`Scope must be a directory: ${scopePath}`);
  return resolvedPath;
}

async function resolveSourceRoots(scopePath: string, sourcePaths: readonly string[]): Promise<readonly string[]> {
  if (sourcePaths.length === 0) throw new Error("At least one source path is required.");

  return Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const resolvedPath = await realpath(resolve(scopePath, sourcePath));
      if (!isPathInside(scopePath, resolvedPath)) {
        throw new Error(`Source path must stay within the scope: ${sourcePath}`);
      }
      return resolvedPath;
    }),
  );
}

export async function discoverSourceFiles(
  scopePath: string,
  sourcePaths: readonly string[],
  excludeGlobs: readonly string[],
): Promise<readonly DiscoveredSourceFile[]> {
  const sourceRoots = await resolveSourceRoots(scopePath, sourcePaths);
  const effectiveExcludeGlobs = [...defaultExcludeGlobs, ...excludeGlobs];
  const discoveredSources = new Map<string, DiscoveredSourceFile>();
  const visitedDirectories = new Set<string>();

  async function visitPath(candidatePath: string): Promise<void> {
    const lexicalRelativePath = toPosixPath(relative(scopePath, candidatePath));
    if (isDirectoryExcluded(lexicalRelativePath, effectiveExcludeGlobs)) return;

    const canonicalPath = await realpath(candidatePath);
    if (!isPathInside(scopePath, canonicalPath)) {
      throw new Error(`Source path resolves outside the scope: ${lexicalRelativePath}`);
    }

    const candidateStat = await lstat(canonicalPath);
    if (candidateStat.isDirectory()) {
      if (visitedDirectories.has(canonicalPath)) return;
      visitedDirectories.add(canonicalPath);
      const entries = await readdir(canonicalPath);
      await Promise.all(entries.map((entry) => visitPath(join(canonicalPath, entry))));
      return;
    }
    if (!candidateStat.isFile()) return;

    const relativePath = toPosixPath(relative(scopePath, canonicalPath));
    if (!sourceExtensionSet.has(extname(relativePath)) || isExcluded(relativePath, effectiveExcludeGlobs)) return;
    discoveredSources.set(canonicalPath, { absolutePath: canonicalPath, relativePath });
  }

  for (const sourceRoot of sourceRoots) await visitPath(sourceRoot);

  const files = [...discoveredSources.values()].toSorted((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  if (files.length === 0) throw new Error("No JavaScript or TypeScript source files remained after filtering.");

  return files;
}
