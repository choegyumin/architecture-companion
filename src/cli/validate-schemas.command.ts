import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH, readArtifact } from "@/server/read-artifact";
import { resolveConsumerScopePath } from "@/server/resolve-consumer-scope";

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
  const result = await readArtifact(scopePath);

  if (result.status === "missing") {
    throw new Error(`Artifact is missing: ${BEHAVIORS_RELATIVE_PATH} and ${DESIGNS_RELATIVE_PATH} do not exist`);
  }
  if (result.status === "invalid") {
    throw new Error(result.message);
  }

  options.writeStdout("Artifact is valid.\n");
}
