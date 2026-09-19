import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Artifact } from "@/features/artifact/artifact";
import { type Diagram, parseDiagram } from "@/features/diagram/diagram";
import { validateArtifact } from "@/server/validate-artifact";

export const BEHAVIORS_RELATIVE_PATH = ".architecture-companion/behaviors";
export const DESIGNS_RELATIVE_PATH = ".architecture-companion/designs";

const DIAGRAM_FILE_SUFFIX = ".json";
const DIAGRAM_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.json$/;

export type ReadArtifactResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "valid"; artifact: Artifact }>
  | Readonly<{ status: "invalid"; message: string }>;

const artifactKinds = [
  { key: "behaviors", relativePath: BEHAVIORS_RELATIVE_PATH },
  { key: "designs", relativePath: DESIGNS_RELATIVE_PATH },
] as const;

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readDiagramFile(scopePath: string, relativePath: string, fileName: string): Promise<Diagram | string> {
  const filePath = join(relativePath, fileName);

  let input: unknown;
  try {
    input = JSON.parse(await readFile(join(scopePath, filePath), "utf8"));
  } catch {
    return `Artifact contains invalid JSON: ${filePath}`;
  }

  try {
    const diagram = parseDiagram(input);
    if (diagram.id !== fileName.slice(0, -DIAGRAM_FILE_SUFFIX.length)) {
      return `Diagram file name does not match the diagram ID: ${filePath} must be ${diagram.id}.json`;
    }
    return diagram;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown validation error";
    return `Artifact is invalid: ${filePath}. ${detail}`;
  }
}

export async function readArtifact(scopePath: string): Promise<ReadArtifactResult> {
  const errors: string[] = [];
  const behaviors: Diagram[] = [];
  const designs: Diagram[] = [];
  let missingKinds = 0;

  for (const { key, relativePath } of artifactKinds) {
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
      if (!DIAGRAM_FILE_NAME_PATTERN.test(entry)) {
        errors.push(`Unexpected artifact entry: ${join(relativePath, entry)}`);
        continue;
      }

      const diagram = await readDiagramFile(scopePath, relativePath, entry);
      if (typeof diagram === "string") {
        errors.push(diagram);
        continue;
      }
      (key === "behaviors" ? behaviors : designs).push(diagram);
    }
  }

  if (missingKinds === artifactKinds.length) return { status: "missing" };
  if (errors.length > 0) return { status: "invalid", message: errors.join("; ") };

  const artifact = validateArtifact({ behaviors, designs });
  return { status: "valid", artifact };
}
