import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeSchemaFiles } from "./_schema-synchronization";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distributionRoot = join(packageRoot, "skills", "architecture-companion");
const sourceGeneratorsRoot = join(packageRoot, "src", "plugins", "diagram-generators");
const distributionGeneratorsRoot = join(distributionRoot, "runtime", "diagram-generators");

await writeSchemaFiles(join(distributionRoot, "schemas"));
await mkdir(distributionGeneratorsRoot, { recursive: true });

const sourceGeneratorEntries = await readdir(sourceGeneratorsRoot, { withFileTypes: true });
await Promise.all(
  sourceGeneratorEntries
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      const destinationDirectory = join(distributionGeneratorsRoot, name);
      await mkdir(destinationDirectory, { recursive: true });
      await cp(join(sourceGeneratorsRoot, name, "GENERATOR.md"), join(destinationDirectory, "GENERATOR.md"), {
        force: true,
      });
    }),
);
