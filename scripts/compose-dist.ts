import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distributionRoot = join(packageRoot, "dist");

const expectedTopLevelEntries = [
  "README.md",
  "SKILL.md",
  "client",
  "diagram-generators",
  "references",
  "serve.js",
  "validate-schemas.js",
  "view-annotations.js",
  "view-generators.js",
] as const;

const projections = [
  { source: join(packageRoot, "README.md"), destination: join(distributionRoot, "README.md") },
  { source: join(packageRoot, "SKILL.md"), destination: join(distributionRoot, "SKILL.md") },
  { source: join(packageRoot, "references"), destination: join(distributionRoot, "references") },
  {
    source: join(packageRoot, "src", "plugins", "diagram-generators"),
    destination: join(distributionRoot, "diagram-generators"),
  },
] as const;

await Promise.all(
  projections.map(({ source, destination }) => cp(source, destination, { recursive: true, force: true })),
);

const actualTopLevelEntries = (await readdir(distributionRoot)).toSorted();
if (JSON.stringify(actualTopLevelEntries) !== JSON.stringify(expectedTopLevelEntries)) {
  throw new Error(
    `Unexpected distribution entries. Expected ${JSON.stringify(expectedTopLevelEntries)}, received ${JSON.stringify(actualTopLevelEntries)}.`,
  );
}
