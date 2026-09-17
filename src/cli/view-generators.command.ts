import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DiagramGeneratorId } from "@/features/diagram-generator/diagram-generator-id";
import { parseDiagramGeneratorManifest } from "@/features/diagram-generator/diagram-generator-manifest";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

export type DiagramGeneratorSource = "built-in" | "global" | "project";

export type DiagramGeneratorDescriptor = Readonly<{
  id: DiagramGeneratorId;
  description: string;
  source: DiagramGeneratorSource;
  path: string;
}>;

export type ViewGeneratorsCommandEnvironment = Readonly<{
  builtInGeneratorsRoot: string;
  homeDirectory: string;
  writeStdout: (output: string) => void;
}>;

const sourceRank: Readonly<Record<DiagramGeneratorSource, number>> = {
  "built-in": 0,
  global: 1,
  project: 2,
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareGenerators(left: DiagramGeneratorDescriptor, right: DiagramGeneratorDescriptor): number {
  const idOrder = compareText(left.id, right.id);
  if (idOrder !== 0) return idOrder;

  const sourceOrder = sourceRank[left.source] - sourceRank[right.source];
  if (sourceOrder !== 0) return sourceOrder;

  return compareText(left.path, right.path);
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function readGenerator(
  pluginPath: string,
  source: DiagramGeneratorSource,
): Promise<DiagramGeneratorDescriptor | null> {
  const manifestPath = join(pluginPath, "GENERATOR.md");

  try {
    await lstat(manifestPath);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw new Error(`Failed to inspect diagram generator manifest at ${manifestPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    const manifest = parseDiagramGeneratorManifest(await readFile(manifestPath, "utf8"));
    return { id: manifest.id, description: manifest.description, source, path: pluginPath };
  } catch (error) {
    throw new Error(`Failed to load diagram generator manifest at ${manifestPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

async function listGeneratorRoot(
  rootPath: string,
  source: DiagramGeneratorSource,
): Promise<readonly DiagramGeneratorDescriptor[]> {
  let entries;

  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw new Error(`Failed to read diagram generator root at ${rootPath}: ${errorMessage(error)}`, { cause: error });
  }

  const generators = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => readGenerator(resolve(rootPath, entry.name), source)),
  );

  return generators.filter((generator): generator is DiagramGeneratorDescriptor => generator !== null);
}

export async function executeViewGeneratorsCommand(
  args: readonly string[],
  environment: ViewGeneratorsCommandEnvironment,
): Promise<void> {
  const scopeInput = args.at(0);
  if (args.length !== 1 || scopeInput === undefined) throw new Error("Usage: node view-generators.js <scope>");

  const scope = await resolveConsumerScope(scopeInput);
  const generatorRoots = [
    { path: resolve(environment.builtInGeneratorsRoot), source: "built-in" },
    {
      path: resolve(environment.homeDirectory, ".architecture-companion", "diagram-generators"),
      source: "global",
    },
    { path: join(scope.path, ".architecture-companion", "diagram-generators"), source: "project" },
  ] as const;
  const generators = (await Promise.all(generatorRoots.map(({ path, source }) => listGeneratorRoot(path, source))))
    .flat()
    .toSorted(compareGenerators);

  environment.writeStdout(`${JSON.stringify(generators)}\n`);
}
