import { fileURLToPath } from "node:url";

import { assertSchemaFilesCurrent, writeSchemaFiles } from "./_schema-synchronization";

const schemasRoot = fileURLToPath(new URL("../skills/architecture-companion/schemas", import.meta.url));

if (process.argv.includes("--check")) {
  await assertSchemaFilesCurrent(schemasRoot);
} else {
  await writeSchemaFiles(schemasRoot);
}
