import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { type Artifact, parseArtifact } from "@/features/artifact/artifact";
import type { CompanionCatalog } from "@/features/catalog/catalog";
import { validateCatalog } from "@/server/validate-catalog";

export const BEHAVIORS_RELATIVE_PATH = ".architecture-companion/behaviors";
export const DESIGNS_RELATIVE_PATH = ".architecture-companion/designs";

const ARTIFACT_FILE_SUFFIX = ".json";
const ARTIFACT_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.json$/;

export type ReadCatalogResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "valid"; catalog: CompanionCatalog }>
  | Readonly<{ status: "invalid"; message: string }>;

const catalogKinds = [
  { key: "behaviors", relativePath: BEHAVIORS_RELATIVE_PATH },
  { key: "designs", relativePath: DESIGNS_RELATIVE_PATH },
] as const;

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readArtifactFile(scopePath: string, relativePath: string, fileName: string): Promise<Artifact | string> {
  const filePath = join(relativePath, fileName);

  let input: unknown;
  try {
    input = JSON.parse(await readFile(join(scopePath, filePath), "utf8"));
  } catch {
    return `Catalog contains invalid JSON: ${filePath}`;
  }

  try {
    const artifact = parseArtifact(input);
    if (artifact.id !== fileName.slice(0, -ARTIFACT_FILE_SUFFIX.length)) {
      return `Artifact file name does not match the artifact ID: ${filePath} must be ${artifact.id}.json`;
    }
    return artifact;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown validation error";
    return `Catalog is invalid: ${filePath}. ${detail}`;
  }
}

export async function readCatalog(scopePath: string): Promise<ReadCatalogResult> {
  const errors: string[] = [];
  const behaviors: Artifact[] = [];
  const designs: Artifact[] = [];
  let missingKinds = 0;

  for (const { key, relativePath } of catalogKinds) {
    let entries: readonly string[];
    try {
      entries = (await readdir(join(scopePath, relativePath))).toSorted();
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        missingKinds += 1;
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!ARTIFACT_FILE_NAME_PATTERN.test(entry)) {
        errors.push(`Unexpected catalog entry: ${join(relativePath, entry)}`);
        continue;
      }

      const artifact = await readArtifactFile(scopePath, relativePath, entry);
      if (typeof artifact === "string") {
        errors.push(artifact);
        continue;
      }
      (key === "behaviors" ? behaviors : designs).push(artifact);
    }
  }

  if (missingKinds === catalogKinds.length) return { status: "missing" };
  if (errors.length > 0) return { status: "invalid", message: errors.join("; ") };

  const catalog = validateCatalog({ behaviors, designs });
  return { status: "valid", catalog };
}
