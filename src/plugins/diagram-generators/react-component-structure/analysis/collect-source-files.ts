import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import ignore, { type Ignore } from "ignore";

import { isMissingPathError, isPathInside, toPosixPath } from "@/shared/node/path";

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs"]);
const alwaysIgnoredDirectoryNames = new Set([".git", "node_modules"]);

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

function addIgnoreRules(rules: Ignore, contents: string | undefined): Ignore {
  // Later rules win, so a child .gitignore is appended after everything it inherits.
  return contents === undefined ? rules : ignore().add(rules).add(contents);
}

/**
 * Builds the inherited rules for the directories from the base down to, but
 * excluding, the given directory, so a nested source root still inherits the
 * `.gitignore` files of its ancestors. Lookup never goes above the base.
 */
async function collectInheritedIgnoreRules(scopePath: string, directoryPath: string): Promise<Ignore> {
  let rules = ignore();
  const directoryRelativePath = relative(scopePath, directoryPath);

  let currentPath = scopePath;
  for (const segment of ["", ...(directoryRelativePath ? directoryRelativePath.split(/[\\/]/) : [])]) {
    if (segment) currentPath = join(currentPath, segment);
    rules = addIgnoreRules(rules, await readIgnoreFileContents(join(currentPath, ".gitignore")));
  }
  return rules;
}

function isPathIgnored(rules: Ignore, relativePath: string, isDirectory: boolean): boolean {
  return rules.ignores(relativePath) || (isDirectory && rules.ignores(`${relativePath}/`));
}

export async function collectSourceFiles(
  scopePath: string,
  sourcePaths: readonly string[],
): Promise<readonly string[]> {
  const files = new Set<string>();

  async function visitFile(resolvedPath: string): Promise<void> {
    if (!sourceExtensions.has(extname(resolvedPath))) return;
    files.add(resolvedPath);
  }

  async function visitDirectory(directoryPath: string, inheritedRules: Ignore): Promise<void> {
    const directoryRules = addIgnoreRules(
      inheritedRules,
      await readIgnoreFileContents(join(directoryPath, ".gitignore")),
    );

    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const resolvedPath = await realpath(join(directoryPath, entry.name));
      if (!isPathInside(scopePath, resolvedPath)) {
        throw new Error(`Source path must stay inside the base: ${join(directoryPath, entry.name)}`);
      }

      const relativePath = toPosixPath(relative(scopePath, resolvedPath));
      if (entry.isDirectory()) {
        if (alwaysIgnoredDirectoryNames.has(entry.name)) continue;
        if (relativePath && isPathIgnored(directoryRules, relativePath, true)) continue;
        await visitDirectory(resolvedPath, directoryRules);
        continue;
      }
      if (relativePath && isPathIgnored(directoryRules, relativePath, false)) continue;
      await visitFile(resolvedPath);
    }
  }

  for (const sourcePath of sourcePaths) {
    const resolvedRoot = await realpath(isAbsolute(sourcePath) ? sourcePath : resolve(scopePath, sourcePath));
    if (!isPathInside(scopePath, resolvedRoot)) {
      throw new Error(`Source path must stay inside the base: ${sourcePath}`);
    }

    // Walk roots are explicit selections: the root itself bypasses every
    // ignore rule, while its descendants are matched normally.
    const inheritedRules =
      resolvedRoot === scopePath ? ignore() : await collectInheritedIgnoreRules(scopePath, dirname(resolvedRoot));
    const rootStat = await stat(resolvedRoot);
    if (rootStat.isDirectory()) {
      await visitDirectory(resolvedRoot, inheritedRules);
    } else if (rootStat.isFile()) {
      await visitFile(resolvedRoot);
    }
  }

  return [...files].toSorted();
}
