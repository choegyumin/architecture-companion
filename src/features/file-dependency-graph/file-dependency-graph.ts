import { access, lstat, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ICruiseResult, IDependency, IModule } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import micromatch from "micromatch";

import { type DiagramGraph, diagramGraphSchema } from "@/features/diagram/diagram-graph";

export type FileDependencyGraphOptions = Readonly<{
  scopePath: string;
  sourcePaths: readonly string[];
  exclude?: readonly string[];
  tsConfigPath?: string;
}>;

type DependencyKind = "runtime" | "type-only";

type PackageInfo = Readonly<{
  name: string;
  rootPath: string;
  relativeRootPath: string;
}>;

type SourceRoot = Readonly<{
  path: string;
  isFile: boolean;
}>;

const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const defaultExcludeGlobs = [
  "**/__tests__/**",
  "**/*.{test,spec}.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
  "**/{.next,.nuxt,.svelte-kit,build,coverage,dist,node_modules,out}/**",
  "**/__generated__/**",
  "**/*.{gen,generated}.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
] as const;
const externalDependencyTypes = new Set([
  "npm",
  "npm-bundled",
  "npm-dev",
  "npm-no-pkg",
  "npm-optional",
  "npm-peer",
  "npm-unknown",
]);
const importConditionNames = ["node", "import", "default"] as const;
const requireConditionNames = ["node", "require", "default"] as const;
const resolverExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;

let cruiseQueue: Promise<void> = Promise.resolve();

function pathToPosix(path: string): string {
  return path.split(sep).join("/");
}

function isInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function compareById<T extends Readonly<{ id: string }>>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function sourceKind(path: string): string {
  if (path.endsWith(".tsx")) return "TypeScript JSX";
  if (path.endsWith(".mts")) return "TypeScript ESM";
  if (path.endsWith(".cts")) return "TypeScript CommonJS";
  if (path.endsWith(".ts")) return "TypeScript";
  if (path.endsWith(".jsx")) return "JavaScript JSX";
  if (path.endsWith(".mjs")) return "JavaScript ESM";
  if (path.endsWith(".cjs")) return "JavaScript CommonJS";
  return "JavaScript";
}

function sourceHref(relativePath: string): string {
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `source:///${encodedPath}`;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  const [name] = specifier.split("/");
  return name || null;
}

function dependencyKind(dependency: IDependency): DependencyKind {
  return dependency.typeOnly || dependency.preCompilationOnly ? "type-only" : "runtime";
}

function isExternalDependency(dependency: IDependency): boolean {
  return dependency.dependencyTypes.some((type) => externalDependencyTypes.has(type));
}

function isCoreDependency(dependency: IDependency): boolean {
  return dependency.coreModule || dependency.dependencyTypes.includes("core");
}

function isSelectedSource(path: string, sourceRoots: readonly SourceRoot[]): boolean {
  return sourceRoots.some((sourceRoot) =>
    sourceRoot.isFile ? sourceRoot.path === path : isInside(sourceRoot.path, path),
  );
}

function isExcluded(relativePath: string, excludeGlobs: readonly string[]): boolean {
  return micromatch.isMatch(relativePath, excludeGlobs, { dot: true });
}

async function resolveScopePath(scopePath: string): Promise<string> {
  const resolvedPath = await realpath(resolve(scopePath));
  if (!(await lstat(resolvedPath)).isDirectory()) throw new Error(`Scope must be a directory: ${scopePath}`);
  return resolvedPath;
}

async function resolveSourceRoots(scopePath: string, sourcePaths: readonly string[]): Promise<readonly SourceRoot[]> {
  if (sourcePaths.length === 0) throw new Error("At least one source path is required.");

  return Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const resolvedPath = await realpath(resolve(scopePath, sourcePath));
      if (!isInside(scopePath, resolvedPath)) throw new Error(`Source path must stay within the scope: ${sourcePath}`);
      return { path: resolvedPath, isFile: (await lstat(resolvedPath)).isFile() };
    }),
  );
}

async function resolveTsConfigPath(scopePath: string, tsConfigPath: string | undefined): Promise<string | undefined> {
  const candidatePath = resolve(scopePath, tsConfigPath ?? "tsconfig.json");

  try {
    await access(candidatePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT" && tsConfigPath === undefined) {
      return undefined;
    }
    throw error;
  }

  if (!isInside(scopePath, candidatePath))
    throw new Error(`TypeScript config must stay within the scope: ${tsConfigPath}`);
  return candidatePath;
}

async function runSerializedCruise<T>(workingDirectory: string, action: () => Promise<T>): Promise<T> {
  const previousCruise = cruiseQueue;
  let releaseCruise: () => void = () => undefined;
  cruiseQueue = new Promise<void>((resolveQueue) => {
    releaseCruise = resolveQueue;
  });

  await previousCruise;
  const previousWorkingDirectory = process.cwd();
  process.chdir(workingDirectory);

  try {
    return await action();
  } finally {
    process.chdir(previousWorkingDirectory);
    releaseCruise();
  }
}

function readCruiseResult(output: ICruiseResult | string): ICruiseResult {
  if (typeof output === "string")
    throw new Error("dependency-cruiser returned formatted output instead of graph data.");
  return output;
}

async function cruisePass(
  scopePath: string,
  sourcePaths: readonly string[],
  tsConfigPath: string | undefined,
  conditionNames: readonly string[],
  mainFields: readonly string[],
): Promise<ICruiseResult> {
  const tsConfig = tsConfigPath ? extractTSConfig(tsConfigPath) : undefined;
  const result = await cruise(
    [...sourcePaths],
    {
      baseDir: scopePath,
      doNotFollow: "(^|/)node_modules/",
      progress: { type: "none" },
      skipAnalysisNotInRules: true,
      tsPreCompilationDeps: "specify",
      ...(tsConfigPath ? { tsConfig: { fileName: tsConfigPath } } : {}),
    },
    {
      conditionNames: [...conditionNames],
      exportsFields: ["exports"],
      extensions: [...resolverExtensions],
      mainFields: [...mainFields],
      mainFiles: ["index"],
    },
    tsConfig ? { tsConfig } : undefined,
  );
  return readCruiseResult(result.output);
}

async function cruiseDependencies(
  scopePath: string,
  sourcePaths: readonly string[],
  tsConfigPath: string | undefined,
): Promise<readonly IModule[]> {
  const cruiseWorkingDirectory = tsConfigPath ? dirname(tsConfigPath) : scopePath;

  return runSerializedCruise(cruiseWorkingDirectory, async () => {
    const importResult = await cruisePass(scopePath, sourcePaths, tsConfigPath, importConditionNames, [
      "module",
      "main",
      "types",
      "typings",
    ]);
    const requireResult = await cruisePass(scopePath, sourcePaths, tsConfigPath, requireConditionNames, [
      "main",
      "module",
      "types",
      "typings",
    ]);
    const requireModules = new Map(requireResult.modules.map((module) => [module.source, module]));

    return importResult.modules.map((module) => ({
      ...module,
      dependencies: [
        ...module.dependencies.filter((dependency) => dependency.moduleSystem !== "cjs"),
        ...(requireModules.get(module.source)?.dependencies.filter((dependency) => dependency.moduleSystem === "cjs") ??
          []),
      ],
    }));
  });
}

async function readPackageInfo(scopePath: string, sourcePath: string): Promise<PackageInfo> {
  let currentPath = dirname(sourcePath);

  while (isInside(scopePath, currentPath)) {
    const manifestPath = join(currentPath, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Readonly<{ name?: unknown }>;
      const relativeRootPath = pathToPosix(relative(scopePath, currentPath)) || ".";
      return {
        name: typeof manifest.name === "string" && manifest.name ? manifest.name : relativeRootPath,
        rootPath: currentPath,
        relativeRootPath,
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    if (currentPath === scopePath) break;
    currentPath = dirname(currentPath);
  }

  return {
    name: basename(scopePath),
    rootPath: scopePath,
    relativeRootPath: ".",
  };
}

function packageGroupId(packageInfo: PackageInfo): string {
  return `group:package:${packageInfo.relativeRootPath}`;
}

function directoryGroupId(relativeDirectoryPath: string): string {
  return `group:directory:${relativeDirectoryPath}`;
}

function fileNodeId(relativePath: string): string {
  return `file:${relativePath}`;
}

async function buildGraph(
  scopePath: string,
  sourceRoots: readonly SourceRoot[],
  modules: readonly IModule[],
  excludeGlobs: readonly string[],
): Promise<DiagramGraph> {
  const localModules = modules
    .map((module) => {
      const absolutePath = resolve(scopePath, module.source);
      const relativePath = pathToPosix(relative(scopePath, absolutePath));
      return { absolutePath, module, relativePath };
    })
    .filter(
      ({ absolutePath, relativePath }) =>
        sourceExtensions.has(extname(relativePath)) &&
        isSelectedSource(absolutePath, sourceRoots) &&
        !isExcluded(relativePath, excludeGlobs),
    );

  if (localModules.length === 0) throw new Error("No JavaScript or TypeScript source files remained after filtering.");

  const groups = new Map<string, DiagramGraph["groups"][number]>();
  const packageInfoByFile = new Map<string, PackageInfo>();

  for (const { absolutePath } of localModules) {
    const packageInfo = await readPackageInfo(scopePath, absolutePath);
    packageInfoByFile.set(absolutePath, packageInfo);
    groups.set(packageGroupId(packageInfo), {
      id: packageGroupId(packageInfo),
      title: packageInfo.name,
      description: `Package ${packageInfo.relativeRootPath}`,
    });

    const relativeDirectoryPath = pathToPosix(relative(packageInfo.rootPath, dirname(absolutePath)));
    if (!relativeDirectoryPath) continue;

    let parentId = packageGroupId(packageInfo);
    let accumulatedDirectory = "";
    for (const segment of relativeDirectoryPath.split("/")) {
      accumulatedDirectory = accumulatedDirectory ? `${accumulatedDirectory}/${segment}` : segment;
      const scopeRelativeDirectory = pathToPosix(
        relative(scopePath, join(packageInfo.rootPath, ...accumulatedDirectory.split("/"))),
      );
      const id = directoryGroupId(scopeRelativeDirectory);
      groups.set(id, { id, title: segment, parentId });
      parentId = id;
    }
  }

  const localNodeByPath = new Map<string, string>();
  const nodes: DiagramGraph["nodes"][number][] = [];

  for (const { absolutePath, relativePath } of localModules) {
    const packageInfo = packageInfoByFile.get(absolutePath);
    if (!packageInfo) throw new Error(`Package grouping failed for ${relativePath}.`);
    const relativeDirectoryPath = pathToPosix(relative(scopePath, dirname(absolutePath)));
    const id = fileNodeId(relativePath);
    const groupId =
      dirname(absolutePath) === packageInfo.rootPath
        ? packageGroupId(packageInfo)
        : directoryGroupId(relativeDirectoryPath);
    localNodeByPath.set(absolutePath, id);
    nodes.push({
      type: "default",
      id,
      kind: sourceKind(relativePath),
      title: basename(relativePath),
      details: [relativePath],
      groupId,
      links: [{ href: sourceHref(relativePath) }],
    });
  }

  const externalNodes = new Map<string, DiagramGraph["nodes"][number]>();
  const edges = new Map<string, DiagramGraph["edges"][number]>();

  for (const { absolutePath, module, relativePath } of localModules) {
    const source = localNodeByPath.get(absolutePath);
    if (!source) continue;

    for (const dependency of module.dependencies) {
      if (dependency.couldNotResolve) continue;
      const kind = dependencyKind(dependency);
      const resolvedPath = resolve(scopePath, dependency.resolved);
      let target = localNodeByPath.get(resolvedPath);

      if (!target && isCoreDependency(dependency)) {
        const title = dependency.module.startsWith("node:") ? dependency.module : `node:${dependency.module}`;
        target = `builtin:${title}`;
        externalNodes.set(target, {
          type: "default",
          id: target,
          kind: "Node.js built-in",
          title,
          groupId: "group:node-builtins",
        });
        groups.set("group:node-builtins", { id: "group:node-builtins", title: "Node.js" });
      }

      if (!target && isExternalDependency(dependency)) {
        const packageName = packageNameFromSpecifier(dependency.module);
        if (!packageName) continue;
        target = `external:${packageName}`;
        externalNodes.set(target, {
          type: "default",
          id: target,
          kind: "External package",
          title: packageName,
          groupId: "group:external-packages",
        });
        groups.set("group:external-packages", {
          id: "group:external-packages",
          title: "External packages",
        });
      }

      if (!target) continue;
      const id = `dependency:${source}->${target}:${kind}`;
      edges.set(id, {
        type: "default",
        id,
        source,
        target,
        ...(kind === "type-only" ? { kind: "type-only" } : {}),
      });
    }

    if (!localNodeByPath.has(absolutePath)) throw new Error(`Missing source node for ${relativePath}.`);
  }

  return diagramGraphSchema.parse({
    groups: [...groups.values()].toSorted(compareById),
    nodes: [...externalNodes.values(), ...nodes].toSorted(compareById),
    edges: [...edges.values()].toSorted(compareById),
  });
}

export async function generateFileDependencyGraph(options: FileDependencyGraphOptions): Promise<DiagramGraph> {
  const scopePath = await resolveScopePath(options.scopePath);
  const sourceRoots = await resolveSourceRoots(scopePath, options.sourcePaths);
  const tsConfigPath = await resolveTsConfigPath(scopePath, options.tsConfigPath);
  const relativeSourcePaths = sourceRoots.map(({ path }) => pathToPosix(relative(scopePath, path)) || ".");
  const modules = await cruiseDependencies(scopePath, relativeSourcePaths, tsConfigPath);

  return buildGraph(scopePath, sourceRoots, modules, [...defaultExcludeGlobs, ...(options.exclude ?? [])]);
}

export async function writeFileDependencyGraph(options: FileDependencyGraphOptions): Promise<string> {
  const graph = await generateFileDependencyGraph(options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-companion-file-dependency-graph-"));
  const graphPath = join(temporaryDirectory, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  return graphPath;
}
