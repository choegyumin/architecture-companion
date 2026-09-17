import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Artifact } from "@/features/artifact/artifact";
import { validateArtifact } from "@/server/validate-artifact";

export const ARTIFACT_RELATIVE_PATH = ".architecture-companion/artifact.json";

export type ReadArtifactResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "valid"; artifact: Artifact }>
  | Readonly<{ status: "invalid"; message: string }>;

export async function readArtifact(scopePath: string): Promise<ReadArtifactResult> {
  const artifactPath = join(scopePath, ARTIFACT_RELATIVE_PATH);
  let source: string;

  try {
    source = await readFile(artifactPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { status: "missing" };
    throw error;
  }

  let input: unknown;

  try {
    input = JSON.parse(source);
  } catch {
    return {
      status: "invalid",
      message: `Artifact contains invalid JSON: ${ARTIFACT_RELATIVE_PATH}`,
    };
  }

  try {
    const artifact = validateArtifact(input);
    return { status: "valid", artifact };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown validation error";
    return {
      status: "invalid",
      message: `Artifact is invalid: ${ARTIFACT_RELATIVE_PATH}. ${detail}`,
    };
  }
}
