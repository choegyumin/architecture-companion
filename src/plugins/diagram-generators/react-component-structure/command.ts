import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { generateReactComponentStructureGraph, type GenerateReactComponentStructureOptions } from "./generator";

const usage = `Usage: react-component-structure --scope <directory> --source <path> [--source <path> ...]
  [--tsconfig <path>] [--exclude-file <glob> ...] [--exclude-component <glob> ...] [--output <file>]`;

type CommandEnvironment = Readonly<{
  writeStdout: (output: string) => void;
  currentWorkingDirectory?: () => string;
}>;

type ParsedArguments = GenerateReactComponentStructureOptions & Readonly<{ outputPath?: string }>;

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args.at(index + 1);
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.\n${usage}`);
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let scopePath: string | undefined;
  let tsconfigPath: string | undefined;
  let outputPath: string | undefined;
  const sourcePaths: string[] = [];
  const excludeFilePatterns: string[] = [];
  const excludeComponentPatterns: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--scope") {
      if (scopePath) throw new Error(`--scope may be provided only once.\n${usage}`);
      scopePath = readValue(args, index, option);
      index += 1;
    } else if (option === "--source") {
      sourcePaths.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--tsconfig") {
      if (tsconfigPath) throw new Error(`--tsconfig may be provided only once.\n${usage}`);
      tsconfigPath = readValue(args, index, option);
      index += 1;
    } else if (option === "--exclude-file") {
      excludeFilePatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--exclude-component") {
      excludeComponentPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--output") {
      if (outputPath) throw new Error(`--output may be provided only once.\n${usage}`);
      outputPath = readValue(args, index, option);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${option ?? ""}\n${usage}`);
    }
  }

  if (!scopePath || sourcePaths.length === 0) throw new Error(usage);
  return {
    scopePath,
    sourcePaths,
    ...(tsconfigPath ? { tsconfigPath } : {}),
    ...(excludeFilePatterns.length > 0 ? { excludeFilePatterns } : {}),
    ...(excludeComponentPatterns.length > 0 ? { excludeComponentPatterns } : {}),
    ...(outputPath ? { outputPath } : {}),
  };
}

export async function executeReactComponentStructureCommand(
  args: readonly string[],
  environment: CommandEnvironment,
): Promise<string> {
  const { outputPath, ...options } = parseArguments(args);
  const graph = await generateReactComponentStructureGraph(options);
  const resolvedOutputPath = outputPath
    ? resolve(environment.currentWorkingDirectory?.() ?? process.cwd(), outputPath)
    : join(await mkdtemp(join(tmpdir(), "architecture-companion-react-components-")), "graph.json");
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(graph, undefined, 2)}\n`);
  environment.writeStdout(`${resolvedOutputPath}\n`);
  return resolvedOutputPath;
}
