import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distributionRoot = fileURLToPath(new URL("../skills/architecture-companion", import.meta.url));

await Promise.all(
  ["schemas", "runtime"].map((directoryName) =>
    rm(join(distributionRoot, directoryName), { force: true, recursive: true }),
  ),
);
