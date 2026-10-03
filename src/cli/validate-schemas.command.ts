import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH, readCatalog } from "@/server/read-catalog";
import { resolveCompanionScopePath } from "@/server/resolve-companion-scope";

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

  const scopePath = await resolveCompanionScopePath(scopeInput);
  const result = await readCatalog(scopePath);

  if (result.status === "missing") {
    throw new Error(`Catalog is missing: ${BEHAVIORS_RELATIVE_PATH} and ${DESIGNS_RELATIVE_PATH} do not exist`);
  }
  if (result.status === "invalid") {
    throw new Error(result.message);
  }

  options.writeStdout("Catalog is valid.\n");
}
