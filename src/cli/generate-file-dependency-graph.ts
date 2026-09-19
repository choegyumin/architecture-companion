import { executeGenerateFileDependencyGraphCommand } from "@/cli/generate-file-dependency-graph.command";
import { writeFileDependencyGraph } from "@/features/file-dependency-graph/file-dependency-graph";

try {
  await executeGenerateFileDependencyGraphCommand(process.argv.slice(2), {
    writeGraph: writeFileDependencyGraph,
    writeStdout: (output) => process.stdout.write(output),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "File dependency graph generation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
