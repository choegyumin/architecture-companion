import { readCatalog } from "@/server/read-catalog";
import { resolveCompanionScopePath } from "@/server/resolve-companion-scope";

export type ViewCatalogCommandOptions = Readonly<{
  writeStdout: (output: string) => void;
}>;

export async function executeViewArtifactsCommand(
  args: readonly string[],
  options: ViewCatalogCommandOptions,
): Promise<void> {
  const scopeInput = args.at(0);
  if (args.length !== 1 || scopeInput === undefined) {
    throw new Error("Usage: node view-artifacts.js <scope>");
  }
  const scopePath = await resolveCompanionScopePath(scopeInput);
  const result = await readCatalog(scopePath);
  if (result.status === "invalid") throw new Error(result.message);
  options.writeStdout(`${JSON.stringify(result.status === "valid" ? result.catalog : null)}\n`);
}
