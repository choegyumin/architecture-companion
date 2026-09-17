import { fileURLToPath } from "node:url";

import { assertSchemaFilesCurrent, writeSchemaFiles } from "./_schema-synchronization";

const referencesRoot = fileURLToPath(new URL("../references", import.meta.url));

if (process.argv.includes("--check")) {
  await assertSchemaFilesCurrent(referencesRoot);
} else {
  await writeSchemaFiles(referencesRoot);
}
