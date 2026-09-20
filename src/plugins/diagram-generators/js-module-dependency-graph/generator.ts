import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";

import { analyzeModuleDependencies, resolveTsConfigPath } from "./analyze-module-dependencies";
import { buildGraph } from "./build-graph";
import { discoverSourceFiles, resolveScopePath } from "./discover-source-files";

export type JsModuleDependencyGraphOptions = Readonly<{
  scopePath: string;
  sourcePaths: readonly string[];
  exclude?: readonly string[];
  tsConfigPath?: string;
}>;

export async function generateJsModuleDependencyGraph(options: JsModuleDependencyGraphOptions): Promise<DiagramGraph> {
  const scopePath = await resolveScopePath(options.scopePath);
  const tsConfigPath = await resolveTsConfigPath(scopePath, options.tsConfigPath);
  const files = await discoverSourceFiles(scopePath, options.sourcePaths, options.exclude ?? []);
  const modules = await analyzeModuleDependencies(scopePath, files, tsConfigPath);
  return buildGraph(scopePath, files, modules);
}

export async function writeJsModuleDependencyGraph(options: JsModuleDependencyGraphOptions): Promise<string> {
  const graph = await generateJsModuleDependencyGraph(options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependency-graph-"));
  const graphPath = join(temporaryDirectory, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  return graphPath;
}
