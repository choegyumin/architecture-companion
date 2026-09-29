import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { type DiagramGraph, diagramGraphSchema } from "@/features/diagram/diagram-graph";
import { isMissingPathError, isPathInside, toPosixPath } from "@/shared/node/path";

import type { AnalyzedModule, DependencyKind } from "./analyze-module-dependencies";
import type { DiscoveredSourceFile } from "./discover-source-files";

type LocalBoundary = Readonly<{
  kind: "package" | "scope";
  name: string;
  relativeRootPath: string;
  rootPath: string;
}>;

type LocalGroupDescriptor = Readonly<{
  group: DiagramGraph["groups"][number];
  parentId: string | undefined;
}>;

type LocalGrouping = Readonly<{
  groupIdByFile: ReadonlyMap<string, string>;
  groups: readonly DiagramGraph["groups"][number][];
}>;

function compareById<T extends Readonly<{ id: string }>>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
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
          id: parentId,
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
        group: { id, title: segment },
      });
      parentId = id;
    }

    if (parentId) assignedGroupIdByFile.set(absolutePath, parentId);
    else ungroupedFileCount += 1;
  }

  const rootGroups = [...descriptorsById.values()].filter(({ parentId }) => parentId === undefined);
  const localRootCount = rootGroups.length + ungroupedFileCount;
  const omittedRootId = localRootCount === 1 ? rootGroups.at(0)?.group.id : undefined;
  const groups = [...descriptorsById.values()]
    .filter(({ group }) => group.id !== omittedRootId)
    .map(({ group, parentId }) => ({
      ...group,
      ...(parentId && parentId !== omittedRootId ? { parentId } : {}),
    }))
    .toSorted(compareById);
  const groupIdByFile = new Map<string, string>();

  for (const [absolutePath, groupId] of assignedGroupIdByFile) {
    if (groupId !== omittedRootId) groupIdByFile.set(absolutePath, groupId);
  }

  return { groups, groupIdByFile };
}

export async function buildGraph(
  scopePath: string,
  discoveredSources: readonly DiscoveredSourceFile[],
  analyzedModules: readonly AnalyzedModule[],
): Promise<DiagramGraph> {
  const localGrouping = await buildLocalGrouping(scopePath, discoveredSources);
  const groups = new Map(localGrouping.groups.map((group) => [group.id, group]));
  const localNodeByPath = new Map<string, string>();
  const nodes: DiagramGraph["nodes"][number][] = [];

  for (const { absolutePath, relativePath } of discoveredSources) {
    const id = moduleNodeId(relativePath);
    const groupId = localGrouping.groupIdByFile.get(absolutePath);
    localNodeByPath.set(absolutePath, id);
    nodes.push({
      type: "default",
      id,
      title: basename(relativePath),
      ...(groupId ? { groupId } : {}),
      links: [{ text: "source", href: sourceHref(relativePath) }],
    });
  }

  const externalNodes = new Map<string, DiagramGraph["nodes"][number]>();
  const edges = new Map<string, DiagramGraph["edges"][number]>();

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
          id: target,
          kind: "External package",
          title: dependency.target.packageName,
          groupId: "group:external-packages",
        });
        groups.set("group:external-packages", {
          id: "group:external-packages",
          title: "External packages",
        });
      }

      if (!target) continue;
      const id = dependencyEdgeId(source, target, dependency.kind);
      edges.set(id, {
        type: "default",
        id,
        source,
        target,
        ...(dependency.kind === "type-only" ? { kind: "type-only" } : {}),
      });
    }
  }

  return diagramGraphSchema.parse({
    groups: [...groups.values()].toSorted(compareById),
    nodes: [...externalNodes.values(), ...nodes].toSorted(compareById),
    edges: [...edges.values()].toSorted(compareById),
  });
}
