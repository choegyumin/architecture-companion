import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import ignore, { type Ignore } from "ignore";

import { isMissingPathError, isPathInside, toPosixPath } from "@/shared/node/path";

export type DiscoveredSourceFile = Readonly<{
  absolutePath: string;
  relativePath: string;
}>;

const sourceExtensions = [".tsx", ".mts", ".cts", ".ts", ".jsx", ".mjs", ".cjs", ".js"] as const;
const sourceExtensionSet: ReadonlySet<string> = new Set(sourceExtensions);
const alwaysIgnoredDirectoryNames = new Set([".git", "node_modules"]);

export async function resolveScopePath(scopePath: string): Promise<string> {
  const resolvedPath = await realpath(resolve(scopePath));
  if (!(await lstat(resolvedPath)).isDirectory()) throw new Error(`Base must be a directory: ${scopePath}`);
  return resolvedPath;
}

async function resolveSourceRoots(scopePath: string, sourcePaths: readonly string[]): Promise<readonly string[]> {
  if (sourcePaths.length === 0) throw new Error("At least one source path is required.");

  return Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const resolvedPath = await realpath(resolve(scopePath, sourcePath));
      if (!isPathInside(scopePath, resolvedPath)) {
        throw new Error(`Source path must stay inside the base: ${sourcePath}`);
      }
      return resolvedPath;
    }),
  );
}

async function readIgnoreFileContents(ignoreFilePath: string): Promise<string | undefined> {
  let contents: string;
  try {
    contents = await readFile(ignoreFilePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  return contents;
}

function addRules(rules: Ignore, contents: string | undefined): Ignore {
  // Later rules win, so a child .gitignore is appended after everything it
  // inherits and inline --exclude-path patterns are appended after all of them.
  return contents === undefined ? rules : ignore().add(rules).add(contents);
}

/**
 * Builds the inherited rules for the directories from the base down to, but
 * excluding, the given directory, so a nested source root still inherits the
 * `.gitignore` files of its ancestors. Lookup never goes above the base.
 */
async function collectInheritedRules(scopePath: string, directoryPath: string): Promise<Ignore> {
  let rules = ignore();
  const directoryRelativePath = relative(scopePath, directoryPath);

  let currentPath = scopePath;
  for (const segment of ["", ...(directoryRelativePath ? directoryRelativePath.split(/[\\/]/) : [])]) {
    if (segment) currentPath = join(currentPath, segment);
    rules = addRules(rules, await readIgnoreFileContents(join(currentPath, ".gitignore")));
  }
  return rules;
}

function isPathIgnored(testRules: Ignore, relativePath: string, isDirectory: boolean): boolean {
  return testRules.ignores(relativePath) || (isDirectory && testRules.ignores(`${relativePath}/`));
}

export async function discoverSourceFiles(
  scopePath: string,
  sourcePaths: readonly string[],
  excludePatterns: readonly string[],
): Promise<readonly DiscoveredSourceFile[]> {
  const sourceRoots = await resolveSourceRoots(scopePath, sourcePaths);
  const inlineRules = excludePatterns.length > 0 ? ignore().add([...excludePatterns]) : undefined;
  const discoveredSources = new Map<string, DiscoveredSourceFile>();
  const visitedDirectories = new Set<string>();

  async function visitFile(resolvedPath: string): Promise<void> {
    const relativePath = toPosixPath(relative(scopePath, resolvedPath));
    if (!sourceExtensionSet.has(extname(relativePath))) return;
    discoveredSources.set(resolvedPath, { absolutePath: resolvedPath, relativePath });
  }

  async function visitDirectory(directoryPath: string, inheritedRules: Ignore): Promise<void> {
    if (visitedDirectories.has(directoryPath)) return;
    visitedDirectories.add(directoryPath);

    const directoryRules = addRules(inheritedRules, await readIgnoreFileContents(join(directoryPath, ".gitignore")));
    const testRules = inlineRules ? ignore().add(directoryRules).add(inlineRules) : directoryRules;

    for (const entry of await readdir(directoryPath)) {
      const canonicalPath = await realpath(join(directoryPath, entry));
      if (!isPathInside(scopePath, canonicalPath)) {
        const relativePath = toPosixPath(relative(scopePath, join(directoryPath, entry)));
        throw new Error(`Source path resolves outside the base: ${relativePath}`);
      }
      const entryRelativePath = toPosixPath(relative(scopePath, canonicalPath));
      const entryStat = await lstat(canonicalPath);

      if (entryStat.isDirectory()) {
        if (alwaysIgnoredDirectoryNames.has(entry)) continue;
        if (isPathIgnored(testRules, entryRelativePath, true)) continue;
        await visitDirectory(canonicalPath, directoryRules);
        continue;
      }
      if (!entryStat.isFile()) continue;
      if (isPathIgnored(testRules, entryRelativePath, false)) continue;
      await visitFile(canonicalPath);
    }
  }

  for (const sourceRoot of sourceRoots) {
    // Walk roots are explicit selections: the root itself bypasses every
    // ignore rule, while its descendants are matched normally.
    const inheritedRules =
      sourceRoot === scopePath ? ignore() : await collectInheritedRules(scopePath, dirname(sourceRoot));
    const rootStat = await lstat(sourceRoot);
    if (rootStat.isDirectory()) {
      await visitDirectory(sourceRoot, inheritedRules);
    } else if (rootStat.isFile()) {
      await visitFile(sourceRoot);
    }
  }

  const files = [...discoveredSources.values()].toSorted((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  if (files.length === 0) throw new Error("No JavaScript or TypeScript source files remained after filtering.");

  return files;
}
