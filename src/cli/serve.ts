import { fileURLToPath } from "node:url";

import { executeServeCommand } from "@/cli/serve.command";

try {
  await executeServeCommand(process.argv.slice(2), {
    staticRoot: fileURLToPath(new URL("../client", import.meta.url)),
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
