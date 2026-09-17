import { executeViewAnnotationsCommand } from "@/cli/view-annotations.command";

try {
  await executeViewAnnotationsCommand(process.argv.slice(2), {
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion failed to read annotations.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
