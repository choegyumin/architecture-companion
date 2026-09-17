import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseArtifact } from "@/features/artifact/artifact";
import { resolveConsumerScopePath } from "@/server/resolve-consumer-scope";

const ARTIFACT_RELATIVE_PATH = ".architecture-companion/artifact.json";

export type ValidateSchemasCommandOptions = Readonly<{
  writeStdout: (output: string) => void;
}>;

export async function executeValidateSchemasCommand(
  args: readonly string[],
  options: ValidateSchemasCommandOptions,
): Promise<void> {
  const scopeInput = args.at(0);
  if (args.length !== 1 || scopeInput === undefined) {
    throw new Error("Usage: node validate-schemas.js <scope>");
  }

  const scopePath = await resolveConsumerScopePath(scopeInput);
  let source: string;

  try {
    source = await readFile(join(scopePath, ARTIFACT_RELATIVE_PATH), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Artifact is missing: ${ARTIFACT_RELATIVE_PATH}`, { cause: error });
    }
    throw error;
  }

  let input: unknown;

  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new Error(`Artifact contains invalid JSON: ${ARTIFACT_RELATIVE_PATH}`, { cause: error });
  }

  try {
    parseArtifact(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown validation error";
    throw new Error(`Artifact is invalid: ${ARTIFACT_RELATIVE_PATH}. ${detail}`, { cause: error });
  }

  options.writeStdout("Artifact is valid.\n");
}
