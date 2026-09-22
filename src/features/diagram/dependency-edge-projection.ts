import type { DiagramGraph, DiagramGroup, DiagramNode } from "@/features/diagram/diagram-graph";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type DiagramDependencyFocus = Readonly<{ type: "group" | "node"; id: string }>;

export type DiagramDependencyEdgeProjection =
  | Readonly<{ type: "original"; edgeId: string }>
  | Readonly<{
      type: "aggregate";
      id: string;
      source: string;
      target: string;
      count: number;
    }>;

function getRootGroupId(groupId: string, groupById: ReadonlyMap<string, DiagramGroup>): string {
  let currentId = groupId;
  while (true) {
    const group = getOrThrow(groupById.get(currentId), `Missing diagram group: ${currentId}`);
    if (!group.parentId) return currentId;
    currentId = group.parentId;
  }
}

function getContainingGroupIds(groupId: string, groupById: ReadonlyMap<string, DiagramGroup>): ReadonlySet<string> {
  const containingGroupIds = new Set<string>();
  let currentId: string | undefined = groupId;
  while (currentId) {
    containingGroupIds.add(currentId);
    currentId = getOrThrow(groupById.get(currentId), `Missing diagram group: ${currentId}`).parentId;
  }
  return containingGroupIds;
}

function aggregateEdges(
  edges: readonly Readonly<{ source: string; target: string }>[],
): readonly DiagramDependencyEdgeProjection[] {
  const aggregateByEndpoints = new Map<string, { source: string; target: string; count: number }>();

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    const aggregate = aggregateByEndpoints.get(key);
    if (aggregate) {
      aggregate.count += 1;
    } else {
      aggregateByEndpoints.set(key, { source: edge.source, target: edge.target, count: 1 });
    }
  }

  return [...aggregateByEndpoints.values()].map(({ source, target, count }) => ({
    type: "aggregate",
    id: `aggregate:${source}->${target}`,
    source,
    target,
    count,
  }));
}

function getTopLevelModuleId(node: DiagramNode, groupById: ReadonlyMap<string, DiagramGroup>): string {
  return node.groupId ? getRootGroupId(node.groupId, groupById) : node.id;
}

function projectTopLevelEdges(diagram: DiagramGraph): readonly DiagramDependencyEdgeProjection[] {
  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));

  return aggregateEdges(
    diagram.edges.map((edge) => ({
      source: getTopLevelModuleId(
        getOrThrow(nodeById.get(edge.source), `Missing edge source node: ${edge.source}`),
        groupById,
      ),
      target: getTopLevelModuleId(
        getOrThrow(nodeById.get(edge.target), `Missing edge target node: ${edge.target}`),
        groupById,
      ),
    })),
  );
}

function projectGroupEdges(diagram: DiagramGraph, groupId: string): readonly DiagramDependencyEdgeProjection[] {
  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  getOrThrow(groupById.get(groupId), `Missing focused diagram group: ${groupId}`);
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const insideNodeIds = new Set(
    diagram.nodes
      .filter((node) => node.groupId && getContainingGroupIds(node.groupId, groupById).has(groupId))
      .map(({ id }) => id),
  );
  const originalEdges: DiagramDependencyEdgeProjection[] = [];
  const boundaryEdges: { source: string; target: string }[] = [];

  for (const edge of diagram.edges) {
    const sourceInside = insideNodeIds.has(edge.source);
    const targetInside = insideNodeIds.has(edge.target);
    if (sourceInside && targetInside) {
      originalEdges.push({ type: "original", edgeId: edge.id });
      continue;
    }
    if (sourceInside === targetInside) continue;

    const outsideNode = getOrThrow(
      nodeById.get(sourceInside ? edge.target : edge.source),
      `Missing boundary edge node: ${edge.id}`,
    );
    const outsideModuleId = outsideNode.groupId ?? outsideNode.id;
    boundaryEdges.push(
      sourceInside ? { source: groupId, target: outsideModuleId } : { source: outsideModuleId, target: groupId },
    );
  }

  return [...originalEdges, ...aggregateEdges(boundaryEdges)];
}

function projectNodeEdges(diagram: DiagramGraph, nodeId: string): readonly DiagramDependencyEdgeProjection[] {
  getOrThrow(
    diagram.nodes.find(({ id }) => id === nodeId),
    `Missing focused diagram node: ${nodeId}`,
  );
  return diagram.edges
    .filter(({ source, target }) => source === nodeId || target === nodeId)
    .map(({ id }) => ({ type: "original", edgeId: id }));
}

export function projectDiagramDependencyEdges(
  diagram: DiagramGraph,
  focus?: DiagramDependencyFocus,
): readonly DiagramDependencyEdgeProjection[] {
  if (!focus) return projectTopLevelEdges(diagram);
  return focus.type === "group" ? projectGroupEdges(diagram, focus.id) : projectNodeEdges(diagram, focus.id);
}
