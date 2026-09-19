import { lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

type DiscoveredSource = Readonly<{
  absolutePath: string;
  relativePath: string;
}>;

type PackageInfo = Readonly<{
  name: string;
  rootPath: string;
  relativeRootPath: string;
}>;

type PreparedTsConfig = Readonly<{
  compilerOptions: ReturnType<typeof extractTSConfig> | undefined;
  fileName: string | undefined;
  temporaryDirectory: string | undefined;
}>;

type ResolutionPass = "import" | "require" | "types";

const sourceTypes = [
  { extension: ".tsx", kind: "TypeScript JSX" },
  { extension: ".mts", kind: "TypeScript ESM" },
  { extension: ".cts", kind: "TypeScript CommonJS" },
  { extension: ".ts", kind: "TypeScript" },
  { extension: ".jsx", kind: "JavaScript JSX" },
  { extension: ".mjs", kind: "JavaScript ESM" },
  { extension: ".cjs", kind: "JavaScript CommonJS" },
  { extension: ".js", kind: "JavaScript" },
] as const;
const sourceExtensions = new Set(sourceTypes.map(({ extension }) => extension));
const sourceExtensionGlob = sourceTypes.map(({ extension }) => extension.slice(1)).join(",");
const defaultExcludeGlobs = [
  "**/{__tests__,test,tests}/**",
  `**/*.{test,spec}.{${sourceExtensionGlob}}`,
  "**/*.{test,spec}.d.{ts,mts,cts}",
  "**/{.next,.nuxt,.svelte-kit,build,coverage,dist,node_modules,out}/**",
  "**/{__generated__,generated}/**",
  `**/*.{gen,generated}.{${sourceExtensionGlob}}`,
  "**/*.{gen,generated}.d.{ts,mts,cts}",
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
const typesConditionNames = ["types", "node", "import", "default"] as const;
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
  return sourceTypes.find(({ extension }) => path.endsWith(extension))?.kind ?? "JavaScript";
}

function sourceHref(relativePath: string): string {
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `source:///${encodedPath}`;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith("#") || specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  const [name] = specifier.split("/");
  return name || null;
}

function packageNameFromResolvedPath(resolvedPath: string): string | null {
  const segments = pathToPosix(resolvedPath).split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex === -1) return null;
  const firstSegment = segments.at(nodeModulesIndex + 1);
  if (!firstSegment) return null;
  if (!firstSegment.startsWith("@")) return firstSegment;
  const secondSegment = segments.at(nodeModulesIndex + 2);
  return secondSegment ? `${firstSegment}/${secondSegment}` : null;
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

function isExcluded(relativePath: string, excludeGlobs: readonly string[]): boolean {
  return micromatch.isMatch(relativePath, excludeGlobs, { dot: true });
}

function isDirectoryExcluded(relativeDirectoryPath: string, excludeGlobs: readonly string[]): boolean {
  if (!relativeDirectoryPath) return false;
  const probes = sourceTypes.flatMap(({ extension }) => [
    `${relativeDirectoryPath}/__architecture_companion_probe__${extension}`,
    `${relativeDirectoryPath}/nested/__architecture_companion_probe__${extension}`,
  ]);
  return probes.every((probe) => isExcluded(probe, excludeGlobs));
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function resolveScopePath(scopePath: string): Promise<string> {
  const resolvedPath = await realpath(resolve(scopePath));
  if (!(await lstat(resolvedPath)).isDirectory()) throw new Error(`Scope must be a directory: ${scopePath}`);
  return resolvedPath;
}

async function resolveSourceRoots(scopePath: string, sourcePaths: readonly string[]): Promise<readonly string[]> {
  if (sourcePaths.length === 0) throw new Error("At least one source path is required.");

  return Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const resolvedPath = await realpath(resolve(scopePath, sourcePath));
      if (!isInside(scopePath, resolvedPath)) throw new Error(`Source path must stay within the scope: ${sourcePath}`);
      return resolvedPath;
    }),
  );
}

async function discoverSources(
  scopePath: string,
  sourceRoots: readonly string[],
  excludeGlobs: readonly string[],
): Promise<readonly DiscoveredSource[]> {
  const discoveredSources = new Map<string, DiscoveredSource>();
  const visitedDirectories = new Set<string>();

  async function visitPath(candidatePath: string): Promise<void> {
    const lexicalRelativePath = pathToPosix(relative(scopePath, candidatePath));
    if (isDirectoryExcluded(lexicalRelativePath, excludeGlobs)) return;

    const canonicalPath = await realpath(candidatePath);
    if (!isInside(scopePath, canonicalPath)) {
      throw new Error(`Source path resolves outside the scope: ${lexicalRelativePath}`);
    }

    const candidateStat = await lstat(canonicalPath);
    if (candidateStat.isDirectory()) {
      if (visitedDirectories.has(canonicalPath)) return;
      visitedDirectories.add(canonicalPath);
      const entries = await readdir(canonicalPath);
      await Promise.all(entries.map((entry) => visitPath(join(canonicalPath, entry))));
      return;
    }
    if (!candidateStat.isFile()) return;

    const relativePath = pathToPosix(relative(scopePath, canonicalPath));
    if (!sourceExtensions.has(extname(relativePath)) || isExcluded(relativePath, excludeGlobs)) return;
    discoveredSources.set(canonicalPath, { absolutePath: canonicalPath, relativePath });
  }

  for (const sourceRoot of sourceRoots) await visitPath(sourceRoot);

  return [...discoveredSources.values()].toSorted((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
}

async function resolveTsConfigPath(scopePath: string, tsConfigPath: string | undefined): Promise<string | undefined> {
  const candidatePath = resolve(scopePath, tsConfigPath ?? "tsconfig.json");
  let canonicalPath: string;

  try {
    canonicalPath = await realpath(candidatePath);
  } catch (error) {
    if (isMissingPath(error) && tsConfigPath === undefined) return undefined;
    throw error;
  }

  if (!isInside(scopePath, canonicalPath)) {
    throw new Error(`TypeScript config must stay within the scope: ${tsConfigPath ?? "tsconfig.json"}`);
  }
  if (!(await lstat(canonicalPath)).isFile()) throw new Error(`TypeScript config must be a file: ${tsConfigPath}`);
  return canonicalPath;
}

async function prepareTsConfig(tsConfigPath: string | undefined): Promise<PreparedTsConfig> {
  if (!tsConfigPath) return { compilerOptions: undefined, fileName: undefined, temporaryDirectory: undefined };

  const compilerOptions = extractTSConfig(tsConfigPath);
  if (compilerOptions.options.baseUrl || !compilerOptions.options.paths) {
    return { compilerOptions, fileName: tsConfigPath, temporaryDirectory: undefined };
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-companion-tsconfig-"));
  const compatibilityConfigPath = join(temporaryDirectory, "tsconfig.json");
  await writeFile(
    compatibilityConfigPath,
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: dirname(tsConfigPath),
          paths: compilerOptions.options.paths,
        },
      },
      null,
      2,
    )}\n`,
  );

  return {
    compilerOptions: {
      ...compilerOptions,
      options: { ...compilerOptions.options, baseUrl: dirname(tsConfigPath) },
    },
    fileName: compatibilityConfigPath,
    temporaryDirectory,
  };
}

function readCruiseResult(output: ICruiseResult | string): ICruiseResult {
  if (typeof output === "string")
    throw new Error("dependency-cruiser returned formatted output instead of graph data.");
  return output;
}

async function cruisePass(
  scopePath: string,
  sourcePaths: readonly string[],
  tsConfig: PreparedTsConfig,
  conditionNames: readonly string[],
  mainFields: readonly string[],
): Promise<ICruiseResult> {
  const result = await cruise(
    [...sourcePaths],
    {
      baseDir: scopePath,
      detectJSDocImports: true,
      doNotFollow: "(^|/)node_modules/",
      progress: { type: "none" },
      skipAnalysisNotInRules: true,
      tsPreCompilationDeps: "specify",
      ...(tsConfig.fileName ? { tsConfig: { fileName: tsConfig.fileName } } : {}),
    },
    {
      conditionNames: [...conditionNames],
      exportsFields: ["exports"],
      extensions: [...resolverExtensions],
      mainFields: [...mainFields],
      mainFiles: ["index"],
    },
    tsConfig.compilerOptions ? { tsConfig: tsConfig.compilerOptions } : undefined,
  );
  return readCruiseResult(result.output);
}

function dependencyKey(dependency: IDependency): string {
  return JSON.stringify([
    dependency.module,
    dependency.moduleSystem,
    dependency.dynamic,
    dependency.exoticallyRequired,
    dependency.typeOnly ?? false,
    dependency.preCompilationOnly ?? false,
  ]);
}

function resolutionPreference(sourcePath: string, dependencies: readonly IDependency[]): readonly ResolutionPass[] {
  if (dependencies.some((dependency) => dependencyKind(dependency) === "type-only")) {
    return ["types", "import", "require"];
  }
  if (sourcePath.endsWith(".cts") || sourcePath.endsWith(".cjs")) return ["require", "import", "types"];
  if (sourcePath.endsWith(".mts") || sourcePath.endsWith(".mjs")) return ["import", "require", "types"];
  if (dependencies.some(({ moduleSystem }) => moduleSystem === "cjs")) return ["require", "import", "types"];
  return ["import", "require", "types"];
}

function chooseDependency(
  sourcePath: string,
  candidates: Readonly<Partial<Record<ResolutionPass, IDependency>>>,
): IDependency {
  const availableCandidates = Object.values(candidates).filter(
    (candidate): candidate is IDependency => candidate !== undefined,
  );
  const fallbackCandidate = availableCandidates.at(0);
  if (!fallbackCandidate) throw new Error(`dependency-cruiser omitted dependency data for ${sourcePath}.`);
  const preference = resolutionPreference(sourcePath, availableCandidates);
  return (
    preference.map((pass) => candidates[pass]).find((candidate) => candidate && !candidate.couldNotResolve) ??
    preference.map((pass) => candidates[pass]).find((candidate): candidate is IDependency => candidate !== undefined) ??
    fallbackCandidate
  );
}

function mergeCruiseResults(results: Readonly<Record<ResolutionPass, ICruiseResult>>): readonly IModule[] {
  const modulesByPass = Object.fromEntries(
    Object.entries(results).map(([pass, result]) => [
      pass,
      new Map(result.modules.map((module) => [module.source, module])),
    ]),
  ) as Record<ResolutionPass, Map<string, IModule>>;
  const sourcePaths = new Set(Object.values(results).flatMap(({ modules }) => modules.map(({ source }) => source)));

  return [...sourcePaths].toSorted().map((sourcePath) => {
    const baseModule =
      modulesByPass.import.get(sourcePath) ??
      modulesByPass.require.get(sourcePath) ??
      modulesByPass.types.get(sourcePath);
    if (!baseModule) throw new Error(`dependency-cruiser omitted module data for ${sourcePath}.`);

    const candidatesByKey = new Map<string, Partial<Record<ResolutionPass, IDependency>>>();
    for (const pass of ["import", "require", "types"] as const) {
      for (const dependency of modulesByPass[pass].get(sourcePath)?.dependencies ?? []) {
        const key = dependencyKey(dependency);
        candidatesByKey.set(key, { ...candidatesByKey.get(key), [pass]: dependency });
      }
    }

    return {
      ...baseModule,
      dependencies: [...candidatesByKey.entries()]
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, candidates]) => chooseDependency(sourcePath, candidates)),
    };
  });
}

async function cruiseDependencies(
  scopePath: string,
  sourcePaths: readonly string[],
  tsConfigPath: string | undefined,
): Promise<readonly IModule[]> {
  const tsConfig = await prepareTsConfig(tsConfigPath);

  try {
    const importResult = await cruisePass(scopePath, sourcePaths, tsConfig, importConditionNames, [
      "module",
      "main",
      "types",
      "typings",
    ]);
    const requireResult = await cruisePass(scopePath, sourcePaths, tsConfig, requireConditionNames, [
      "main",
      "module",
      "types",
      "typings",
    ]);
    const typesResult = await cruisePass(scopePath, sourcePaths, tsConfig, typesConditionNames, [
      "types",
      "typings",
      "module",
      "main",
    ]);
    return mergeCruiseResults({ import: importResult, require: requireResult, types: typesResult });
  } finally {
    if (tsConfig.temporaryDirectory) await rm(tsConfig.temporaryDirectory, { recursive: true });
  }
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
      if (!isMissingPath(error)) throw error;
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

function dependencyEdgeId(source: string, target: string, kind: DependencyKind): string {
  return `dependency:${encodeURIComponent(source)}:${encodeURIComponent(target)}:${kind}`;
}

async function buildGraph(
  scopePath: string,
  discoveredSources: readonly DiscoveredSource[],
  modules: readonly IModule[],
): Promise<DiagramGraph> {
  const sourceByPath = new Map(discoveredSources.map((source) => [source.absolutePath, source]));
  const moduleByPath = new Map<string, IModule>();

  for (const module of modules) {
    try {
      const canonicalPath = await realpath(resolve(scopePath, module.source));
      if (sourceByPath.has(canonicalPath)) moduleByPath.set(canonicalPath, module);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
  }

  const groups = new Map<string, DiagramGraph["groups"][number]>();
  const packageInfoByFile = new Map<string, PackageInfo>();

  for (const { absolutePath } of discoveredSources) {
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

  for (const { absolutePath, relativePath } of discoveredSources) {
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

  for (const { absolutePath } of discoveredSources) {
    const source = localNodeByPath.get(absolutePath);
    if (!source) continue;

    for (const dependency of moduleByPath.get(absolutePath)?.dependencies ?? []) {
      if (dependency.couldNotResolve || isCoreDependency(dependency)) continue;
      const kind = dependencyKind(dependency);
      let target: string | undefined;

      try {
        const canonicalResolvedPath = await realpath(resolve(scopePath, dependency.resolved));
        target = localNodeByPath.get(canonicalResolvedPath);
      } catch (error) {
        if (!isMissingPath(error)) throw error;
      }

      if (!target && isExternalDependency(dependency)) {
        const packageName =
          packageNameFromResolvedPath(dependency.resolved) ?? packageNameFromSpecifier(dependency.module);
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
      const id = dependencyEdgeId(source, target, kind);
      edges.set(id, {
        type: "default",
        id,
        source,
        target,
        ...(kind === "type-only" ? { kind: "type-only" } : {}),
      });
    }
  }

  return diagramGraphSchema.parse({
    groups: [...groups.values()].toSorted(compareById),
    nodes: [...externalNodes.values(), ...nodes].toSorted(compareById),
    edges: [...edges.values()].toSorted(compareById),
  });
}

export async function generateFileDependencyGraph(options: FileDependencyGraphOptions): Promise<DiagramGraph> {
  const scopePath = await resolveScopePath(options.scopePath);
  const excludeGlobs = [...defaultExcludeGlobs, ...(options.exclude ?? [])];
  const tsConfigPath = await resolveTsConfigPath(scopePath, options.tsConfigPath);
  const sourceRoots = await resolveSourceRoots(scopePath, options.sourcePaths);
  const discoveredSources = await discoverSources(scopePath, sourceRoots, excludeGlobs);
  if (discoveredSources.length === 0) {
    throw new Error("No JavaScript or TypeScript source files remained after filtering.");
  }
  const modules = await cruiseDependencies(
    scopePath,
    discoveredSources.map(({ relativePath }) => relativePath),
    tsConfigPath,
  );

  return buildGraph(scopePath, discoveredSources, modules);
}

export async function writeFileDependencyGraph(options: FileDependencyGraphOptions): Promise<string> {
  const graph = await generateFileDependencyGraph(options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-companion-file-dependency-graph-"));
  const graphPath = join(temporaryDirectory, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  return graphPath;
}
