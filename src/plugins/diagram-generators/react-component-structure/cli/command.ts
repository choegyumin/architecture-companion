import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildComponentGraph, type ComponentGraphOptions } from "../analysis/build-component-graph";

const usage = `Usage: react-component-structure --base <directory> [--tsconfig <path>]
  [--exclude-path <glob> ...] [--exclude-component <glob> ...] [--root <glob> ...] <source-path>...`;

type CommandEnvironment = Readonly<{
  writeStdout: (output: string) => void;
}>;

type ParsedArguments = ComponentGraphOptions;

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args.at(index + 1);
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.\n${usage}`);
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let scopePath: string | undefined;
  let tsconfigPath: string | undefined;
  const sourcePaths: string[] = [];
  const excludeFilePatterns: string[] = [];
  const excludeComponentPatterns: string[] = [];
  const rootPatterns: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--base") {
      if (scopePath) throw new Error(`--base may be provided only once.\n${usage}`);
      scopePath = readValue(args, index, option);
      index += 1;
    } else if (option === "--tsconfig") {
      if (tsconfigPath) throw new Error(`--tsconfig may be provided only once.\n${usage}`);
      tsconfigPath = readValue(args, index, option);
      index += 1;
    } else if (option === "--exclude-path") {
      excludeFilePatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--exclude-component") {
      excludeComponentPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--root") {
      rootPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option.startsWith("--")) {
      throw new Error(`Unknown argument: ${option}\n${usage}`);
    } else {
      sourcePaths.push(option);
    }
  }

  if (!scopePath || sourcePaths.length === 0) throw new Error(usage);
  return {
    scopePath,
    sourcePaths,
    ...(tsconfigPath ? { tsconfigPath } : {}),
    ...(excludeFilePatterns.length > 0 ? { excludeFilePatterns } : {}),
    ...(excludeComponentPatterns.length > 0 ? { excludeComponentPatterns } : {}),
    ...(rootPatterns.length > 0 ? { rootPatterns } : {}),
  };
}

export async function executeReactComponentStructureCommand(
  args: readonly string[],
  environment: CommandEnvironment,
): Promise<string> {
  const options = parseArguments(args);
  const graph = await buildComponentGraph(options);
  const resolvedOutputPath = join(
    await mkdtemp(join(tmpdir(), "architecture-companion-react-components-")),
    "graph.json",
  );
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(graph, undefined, 2)}\n`);
  environment.writeStdout(`${JSON.stringify({ graphPath: resolvedOutputPath })}\n`);
  return resolvedOutputPath;
}
