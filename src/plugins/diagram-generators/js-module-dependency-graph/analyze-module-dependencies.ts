import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { ICruiseResult, IDependency, IModule } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";

import type { DiscoveredSourceFile } from "./discover-source-files";
import { isMissingPathError, isPathInside, toPosixPath } from "./path-safety";

export type DependencyKind = "runtime" | "type-only";

export type AnalyzedDependency = Readonly<{
  kind: DependencyKind;
  target:
    | Readonly<{ type: "external-package"; packageName: string }>
    | Readonly<{ type: "local-module"; absolutePath: string }>;
}>;

export type AnalyzedModule = Readonly<{
  absolutePath: string;
  dependencies: readonly AnalyzedDependency[];
}>;

type PreparedTsConfig = Readonly<{
  compilerOptions: ReturnType<typeof extractTSConfig> | undefined;
  fileName: string | undefined;
  temporaryDirectory: string | undefined;
}>;

type ResolutionPass = "import" | "require" | "types";

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
  const segments = toPosixPath(resolvedPath).split("/");
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

export async function resolveTsConfigPath(
  scopePath: string,
  tsConfigPath: string | undefined,
): Promise<string | undefined> {
  const candidatePath = resolve(scopePath, tsConfigPath ?? "tsconfig.json");
  let canonicalPath: string;

  try {
    canonicalPath = await realpath(candidatePath);
  } catch (error) {
    if (isMissingPathError(error) && tsConfigPath === undefined) return undefined;
    throw error;
  }

  if (!isPathInside(scopePath, canonicalPath)) {
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
  if (typeof output === "string") {
    throw new Error("dependency-cruiser returned formatted output instead of graph data.");
  }
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

export async function analyzeModuleDependencies(
  scopePath: string,
  discoveredSources: readonly DiscoveredSourceFile[],
  tsConfigPath: string | undefined,
): Promise<readonly AnalyzedModule[]> {
  const sourceByPath = new Map(discoveredSources.map((source) => [source.absolutePath, source]));
  const modules = await cruiseDependencies(
    scopePath,
    discoveredSources.map(({ relativePath }) => relativePath),
    tsConfigPath,
  );
  const analyzedModules: AnalyzedModule[] = [];

  for (const module of modules) {
    let absoluteSourcePath: string;
    try {
      absoluteSourcePath = await realpath(resolve(scopePath, module.source));
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    if (!sourceByPath.has(absoluteSourcePath)) continue;

    const dependencies: AnalyzedDependency[] = [];
    for (const dependency of module.dependencies) {
      if (dependency.couldNotResolve || isCoreDependency(dependency)) continue;
      const kind = dependencyKind(dependency);
      let localTargetPath: string | undefined;

      try {
        const canonicalResolvedPath = await realpath(resolve(scopePath, dependency.resolved));
        if (sourceByPath.has(canonicalResolvedPath)) localTargetPath = canonicalResolvedPath;
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }

      if (localTargetPath) {
        dependencies.push({ kind, target: { type: "local-module", absolutePath: localTargetPath } });
        continue;
      }
      if (!isExternalDependency(dependency)) continue;

      const packageName =
        packageNameFromResolvedPath(dependency.resolved) ?? packageNameFromSpecifier(dependency.module);
      if (packageName) {
        dependencies.push({ kind, target: { type: "external-package", packageName } });
      }
    }

    analyzedModules.push({ absolutePath: absoluteSourcePath, dependencies });
  }

  return analyzedModules;
}
