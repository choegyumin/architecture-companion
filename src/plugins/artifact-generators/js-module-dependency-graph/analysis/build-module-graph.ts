import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import type z from "zod";

import { type DependencyDiagramGraph, dependencyDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import { isMissingPathError, isPathInside, toPosixPath } from "@/shared/node/path";

import {
  type AnalyzedModule,
  analyzeModuleDependencies,
  type DependencyKind,
  resolveTsConfigPath,
} from "./analyze-module-dependencies";
import { collectSourceFiles, type DiscoveredSourceFile, resolveScopePath } from "./collect-source-files";

export type ModuleGraphOptions = Readonly<{
  scopePath: string;
  sourcePaths: readonly string[];
  exclude?: readonly string[];
  tsConfigPath?: string;
}>;

type LocalBoundary = Readonly<{
  kind: "package" | "scope";
  name: string;
  relativeRootPath: string;
  rootPath: string;
}>;

type ModuleGraphInput = z.input<typeof dependencyDiagramGraphSchema>;

type LocalGroupDescriptor = Readonly<{
  group: ModuleGraphInput["groups"][number];
  parentId: string | undefined;
}>;

type LocalGrouping = Readonly<{
  groupIdByFile: ReadonlyMap<string, string>;
  groups: readonly ModuleGraphInput["groups"][number][];
}>;

function compareById<K extends "groupId" | "nodeId" | "edgeId">(
  key: K,
): (left: Readonly<Record<K, string>>, right: Readonly<Record<K, string>>) => number {
  return (left, right) => (left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0);
}

function sourceHref(relativePath: string): string {
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `source:///${encodedPath}`;
}

function packageGroupId(relativeDirectoryPath: string): string {
  return `group:package:${relativeDirectoryPath}`;
}

function directoryGroupId(relativeDirectoryPath: string): string {
  return `group:directory:${relativeDirectoryPath}`;
}

function moduleNodeId(relativePath: string): string {
  return `file:${relativePath}`;
}

function dependencyEdgeId(source: string, target: string, kind: DependencyKind): string {
  return `dependency:${encodeURIComponent(source)}:${encodeURIComponent(target)}:${kind}`;
}

async function findLocalBoundary(scopePath: string, sourcePath: string): Promise<LocalBoundary> {
  let currentPath = dirname(sourcePath);

  while (isPathInside(scopePath, currentPath)) {
    try {
      const manifest = JSON.parse(await readFile(join(currentPath, "package.json"), "utf8")) as Readonly<{
        name?: unknown;
      }>;
      const relativeRootPath = toPosixPath(relative(scopePath, currentPath)) || ".";
      return {
        kind: currentPath === scopePath ? "scope" : "package",
        name: typeof manifest.name === "string" && manifest.name ? manifest.name : relativeRootPath,
        rootPath: currentPath,
        relativeRootPath,
      };
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }

    if (currentPath === scopePath) break;
    currentPath = dirname(currentPath);
  }

  return {
    kind: "scope",
    name: basename(scopePath),
    rootPath: scopePath,
    relativeRootPath: ".",
  };
}

async function buildLocalGrouping(
  scopePath: string,
  discoveredSources: readonly DiscoveredSourceFile[],
): Promise<LocalGrouping> {
  const descriptorsById = new Map<string, LocalGroupDescriptor>();
  const assignedGroupIdByFile = new Map<string, string>();
  let ungroupedFileCount = 0;

  for (const { absolutePath } of discoveredSources) {
    const boundary = await findLocalBoundary(scopePath, absolutePath);
    let parentId: string | undefined;

    if (boundary.kind === "package") {
      parentId = packageGroupId(boundary.relativeRootPath);
      descriptorsById.set(parentId, {
        parentId: undefined,
        group: {
          groupId: parentId,
          title: boundary.name,
          description: `Package ${boundary.relativeRootPath}`,
        },
      });
    }

    const relativeDirectoryPath = toPosixPath(relative(boundary.rootPath, dirname(absolutePath)));
    let accumulatedDirectory = "";
    for (const segment of relativeDirectoryPath ? relativeDirectoryPath.split("/") : []) {
      accumulatedDirectory = accumulatedDirectory ? `${accumulatedDirectory}/${segment}` : segment;
      const scopeRelativeDirectory = toPosixPath(
        relative(scopePath, join(boundary.rootPath, ...accumulatedDirectory.split("/"))),
      );
      const id = directoryGroupId(scopeRelativeDirectory);
      descriptorsById.set(id, {
        parentId,
        group: { groupId: id, title: segment },
      });
      parentId = id;
    }

    if (parentId) assignedGroupIdByFile.set(absolutePath, parentId);
    else ungroupedFileCount += 1;
  }

  const rootGroups = [...descriptorsById.values()].filter(({ parentId }) => parentId === undefined);
  const localRootCount = rootGroups.length + ungroupedFileCount;
  const omittedRootId = localRootCount === 1 ? rootGroups.at(0)?.group.groupId : undefined;
  const groups = [...descriptorsById.values()]
    .filter(({ group }) => group.groupId !== omittedRootId)
    .map(({ group, parentId }) => ({
      ...group,
      ...(parentId && parentId !== omittedRootId ? { parentGroupId: parentId } : {}),
    }))
    .toSorted(compareById("groupId"));
  const groupIdByFile = new Map<string, string>();

  for (const [absolutePath, groupId] of assignedGroupIdByFile) {
    if (groupId !== omittedRootId) groupIdByFile.set(absolutePath, groupId);
  }

  return { groups, groupIdByFile };
}

async function buildDiagramGraph(
  scopePath: string,
  discoveredSources: readonly DiscoveredSourceFile[],
  analyzedModules: readonly AnalyzedModule[],
): Promise<DependencyDiagramGraph> {
  const localGrouping = await buildLocalGrouping(scopePath, discoveredSources);
  const groups = new Map(localGrouping.groups.map((group) => [group.groupId, group]));
  const localNodeByPath = new Map<string, string>();
  const nodes: ModuleGraphInput["nodes"][number][] = [];

  for (const { absolutePath, relativePath } of discoveredSources) {
    const id = moduleNodeId(relativePath);
    const groupId = localGrouping.groupIdByFile.get(absolutePath);
    localNodeByPath.set(absolutePath, id);
    nodes.push({
      type: "default",
      nodeId: id,
      title: basename(relativePath),
      ...(groupId ? { groupId } : {}),
      links: [{ text: "source", href: sourceHref(relativePath) }],
    });
  }

  const externalNodes = new Map<string, ModuleGraphInput["nodes"][number]>();
  const edges = new Map<string, ModuleGraphInput["edges"][number]>();

  for (const { absolutePath, dependencies } of analyzedModules) {
    const source = localNodeByPath.get(absolutePath);
    if (!source) continue;

    for (const dependency of dependencies) {
      let target: string | undefined;
      if (dependency.target.type === "local-module") {
        target = localNodeByPath.get(dependency.target.absolutePath);
      } else {
        target = `external:${dependency.target.packageName}`;
        externalNodes.set(target, {
          type: "default",
          nodeId: target,
          kind: "External package",
          title: dependency.target.packageName,
          groupId: "group:external-packages",
          synthetic: true,
        });
        groups.set("group:external-packages", {
          groupId: "group:external-packages",
          title: "External packages",
          synthetic: true,
        });
      }

      if (!target) continue;
      const id = dependencyEdgeId(source, target, dependency.kind);
      edges.set(id, {
        type: "default",
        edgeId: id,
        sourceNodeId: source,
        targetNodeId: target,
        ...(dependency.kind === "type-only" ? { kind: "type-only" } : {}),
      });
    }
  }

  return dependencyDiagramGraphSchema.parse({
    groups: [...groups.values()].toSorted(compareById("groupId")),
    nodes: [...externalNodes.values(), ...nodes].toSorted(compareById("nodeId")),
    edges: [...edges.values()].toSorted(compareById("edgeId")),
  } satisfies ModuleGraphInput);
}

export async function buildModuleGraph(options: ModuleGraphOptions): Promise<DependencyDiagramGraph> {
  const scopePath = await resolveScopePath(options.scopePath);
  const tsConfigPath = await resolveTsConfigPath(scopePath, options.tsConfigPath);
  const discoveredSources = await collectSourceFiles(scopePath, options.sourcePaths, options.exclude ?? []);
  const analyzedModules = await analyzeModuleDependencies(scopePath, discoveredSources, tsConfigPath);
  return buildDiagramGraph(scopePath, discoveredSources, analyzedModules);
}
