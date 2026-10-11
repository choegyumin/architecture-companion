import { executeViewCatalogCommand } from "@/cli/view-catalog.command";

try {
  await executeViewCatalogCommand(process.argv.slice(2), {
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion failed to read the catalog.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
