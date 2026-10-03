import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { buildModuleGraph, type ModuleGraphOptions } from "../analysis/build-module-graph";

export type JsModuleDependencyGraphCommandEnvironment = Readonly<{
  writeGraph: (options: ModuleGraphOptions) => Promise<string>;
  writeStdout: (output: string) => void;
}>;

const usage =
  "Usage: js-module-dependency-graph --base <directory> [--tsconfig <path>] [--exclude-path <glob> ...] <source-path>...";

export async function writeJsModuleDependencyGraph(options: ModuleGraphOptions): Promise<string> {
  const graph = await buildModuleGraph(options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependency-graph-"));
  const graphPath = join(temporaryDirectory, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  return graphPath;
}

export async function executeJsModuleDependencyGraphCommand(
  args: readonly string[],
  environment: JsModuleDependencyGraphCommandEnvironment,
): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      base: { type: "string" },
      "exclude-path": { type: "string", multiple: true },
      tsconfig: { type: "string" },
    },
    strict: true,
  });

  if (!values.base || positionals.length === 0) throw new Error(usage);

  const graphPath = await environment.writeGraph({
    scopePath: values.base,
    sourcePaths: positionals,
    ...(values["exclude-path"] ? { exclude: values["exclude-path"] } : {}),
    ...(values.tsconfig ? { tsConfigPath: values.tsconfig } : {}),
  });
  environment.writeStdout(`${JSON.stringify({ graphPath })}\n`);
}
