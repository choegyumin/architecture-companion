import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { executeViewGeneratorsCommand } from "@/cli/view-generators.command";

try {
  await executeViewGeneratorsCommand(process.argv.slice(2), {
    builtInGeneratorsRoot: fileURLToPath(new URL("../diagram-generators", import.meta.url)),
    homeDirectory: homedir(),
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion failed to list diagram generators.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
