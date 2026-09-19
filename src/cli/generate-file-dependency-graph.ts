import { parseArgs } from "node:util";

import { writeFileDependencyGraph } from "@/features/file-dependency-graph/file-dependency-graph";

const usage = "Usage: node generate.js --scope <scope> [--ts-config <path>] [--exclude <glob> ...] <source-path>...";

try {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      exclude: { type: "string", multiple: true },
      scope: { type: "string" },
      "ts-config": { type: "string" },
    },
    strict: true,
  });

  if (!values.scope || positionals.length === 0) throw new Error(usage);

  const graphPath = await writeFileDependencyGraph({
    scopePath: values.scope,
    sourcePaths: positionals,
    ...(values.exclude ? { exclude: values.exclude } : {}),
    ...(values["ts-config"] ? { tsConfigPath: values["ts-config"] } : {}),
  });
  process.stdout.write(`${JSON.stringify({ graphPath })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "File dependency graph generation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
