import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generatedSchemaFileNames, generateSchemaSources } from "./_schema-generation";

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function writeSchemaFiles(outputRoot: string): Promise<void> {
  const generatedSchemaSources = generateSchemaSources();
  await mkdir(outputRoot, { recursive: true });
  await Promise.all(
    generatedSchemaFileNames.map((fileName) => writeFile(join(outputRoot, fileName), generatedSchemaSources[fileName])),
  );
}

export async function assertSchemaFilesCurrent(outputRoot: string): Promise<void> {
  const generatedSchemaSources = generateSchemaSources();
  const staleFileNames = (
    await Promise.all(
      generatedSchemaFileNames.map(async (fileName) => {
        try {
          const source = await readFile(join(outputRoot, fileName), "utf8");
          return source === generatedSchemaSources[fileName] ? [] : [fileName];
        } catch (error) {
          if (isMissingFileError(error)) return [fileName];
          throw error;
        }
      }),
    )
  ).flat();

  if (staleFileNames.length > 0) {
    throw new Error(`Schemas are missing or stale: ${staleFileNames.join(", ")}. Run \`pnpm run schema-gen\`.`);
  }
}
