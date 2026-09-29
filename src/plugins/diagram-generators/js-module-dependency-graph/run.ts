import { executeJsModuleDependencyGraphCommand, writeJsModuleDependencyGraph } from "./cli/command";

try {
  await executeJsModuleDependencyGraphCommand(process.argv.slice(2), {
    writeGraph: writeJsModuleDependencyGraph,
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "JavaScript module dependency graph generation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
