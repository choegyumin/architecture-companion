import { executeValidateSchemasCommand } from "@/cli/validate-schemas.command";

try {
  await executeValidateSchemasCommand(process.argv.slice(2), {
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Architecture Companion failed to validate Artifact schemas.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
