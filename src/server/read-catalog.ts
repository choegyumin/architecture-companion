import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import ignore, { type Ignore } from "ignore";
import micromatch from "micromatch";

import { type Artifact, parseArtifact } from "@/features/artifact/artifact";
import {
  type CatalogConfig,
  catalogConfigSchema,
  catalogEntrySchema,
  type CompanionCatalog,
} from "@/features/catalog/catalog";

export const ARTIFACTS_RELATIVE_PATH = ".architecture-companion/artifacts";
export const CONFIG_RELATIVE_PATH = ".architecture-companion/config.json";

export type ReadCatalogResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "valid"; catalog: CompanionCatalog }>
  | Readonly<{ status: "invalid"; message: string }>;

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readConfig(scopePath: string): Promise<CatalogConfig> {
  let content;
  try {
    content = await readFile(join(scopePath, CONFIG_RELATIVE_PATH), "utf8");
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return catalogConfigSchema.parse({});
    throw error;
  }
  return catalogConfigSchema.parse(JSON.parse(content));
}

async function discoverArtifactPaths(scopePath: string, config: CatalogConfig) {
  const centralPaths: string[] = [];
  const candidates: string[] = [];
  let centralDirectoryExists = false;
  type IgnoreContext = Readonly<{ directory: string; matcher: Ignore }>;
  async function walk(directory: string, inherited: readonly IgnoreContext[]): Promise<void> {
    let contexts = inherited;
    try {
      const rules = await readFile(join(scopePath, directory, ".gitignore"), "utf8");
      contexts = [...inherited, { directory, matcher: ignore().add(rules) }];
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }
    let entries;
    try {
      entries = await readdir(join(scopePath, directory), { withFileTypes: true });
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (path === CONFIG_RELATIVE_PATH) continue;
      const centralBranch =
        path === ARTIFACTS_RELATIVE_PATH ||
        ARTIFACTS_RELATIVE_PATH.startsWith(`${path}/`) ||
        path.startsWith(`${ARTIFACTS_RELATIVE_PATH}/`);
      if (!centralBranch) {
        let ignored = false;
        for (const context of contexts) {
          const localPath = context.directory ? path.slice(context.directory.length + 1) : path;
          const decision = context.matcher.test(`${localPath}${entry.isDirectory() ? "/" : ""}`);
          if (decision.ignored) ignored = true;
          else if (decision.unignored) ignored = false;
        }
        if (ignored) continue;
      }
      if (entry.isDirectory()) {
        if (path === ARTIFACTS_RELATIVE_PATH) centralDirectoryExists = true;
        await walk(path, contexts);
      } else if (entry.isFile()) {
        const central = path.startsWith(`${ARTIFACTS_RELATIVE_PATH}/`) && path.endsWith(".json");
        if (central) centralPaths.push(path);
        else candidates.push(path);
      }
    }
  }
  await walk("", []);
  const paths = [...centralPaths, ...micromatch(candidates, config.include, { dot: true })].toSorted();
  return { paths, centralDirectoryExists };
}

async function readArtifactFile(scopePath: string, filePath: string): Promise<Artifact | string> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(join(scopePath, filePath), "utf8"));
  } catch {
    return `Catalog contains invalid JSON: ${filePath}`;
  }

  try {
    return { ...parseArtifact(input), artifactId: filePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown validation error";
    return `Catalog is invalid: ${filePath}. ${detail}`;
  }
}

export async function readCatalog(scopePath: string): Promise<ReadCatalogResult> {
  let config;
  try {
    config = await readConfig(scopePath);
  } catch (error) {
    return {
      status: "invalid",
      message: `Catalog configuration is invalid: ${CONFIG_RELATIVE_PATH}. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const { paths, centralDirectoryExists } = await discoverArtifactPaths(scopePath, config);
  if (paths.length === 0 && !centralDirectoryExists) return { status: "missing" };

  const errors: string[] = [];
  const artifacts: Artifact[] = [];
  for (const path of paths) {
    const artifact = await readArtifactFile(scopePath, path);
    if (typeof artifact === "string") errors.push(artifact);
    else artifacts.push(artifact);
  }
  if (errors.length > 0) return { status: "invalid", message: errors.join("; ") };

  // Discovery supplies unique paths; the documents are already normalized above.
  try {
    for (const artifact of artifacts) catalogEntrySchema.parse(artifact);
  } catch (error) {
    throw new Error(`Invalid catalog: ${error instanceof Error ? error.message : "Invalid artifact path"}`, {
      cause: error,
    });
  }
  return { status: "valid", catalog: { artifacts } };
}
