import type { DiagramGraph, DiagramGroup, DiagramNode } from "@/features/diagram/diagram-graph";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type DependencyFocus =
  | Readonly<{ type: "group"; id: string }>
  | Readonly<{ type: "node"; id: string }>
  | Readonly<{ type: "aggregate"; edgeIds: readonly string[] }>;

export type DependencyEdgeProjection =
  | Readonly<{ type: "original"; edgeId: string }>
  | Readonly<{
      type: "aggregate";
      id: string;
      sourceId: string;
      targetId: string;
      edgeIds: readonly string[];
    }>;

type BoundaryEdge = Readonly<{ edgeId: string; sourceId: string; targetId: string }>;

function aggregateEdges(edges: readonly BoundaryEdge[], reservedIds: ReadonlySet<string>): DependencyEdgeProjection[] {
  const byEndpoints = new Map<string, { sourceId: string; targetId: string; edgeIds: string[] }>();
  edges.forEach(({ edgeId, sourceId, targetId }) => {
    if (sourceId === targetId) return;
    const key = JSON.stringify([sourceId, targetId]);
    const aggregate = byEndpoints.get(key);
    if (aggregate) aggregate.edgeIds.push(edgeId);
    else byEndpoints.set(key, { sourceId, targetId, edgeIds: [edgeId] });
  });
  const usedIds = new Set(reservedIds);
  return [...byEndpoints.entries()].map(([key, { sourceId, targetId, edgeIds }]) => {
    let id = `aggregate:${key}`;
    while (usedIds.has(id)) id += ":";
    usedIds.add(id);
    return { type: "aggregate", id, sourceId, targetId, edgeIds };
  });
}

export function projectDependencyEdges(graph: DiagramGraph, focus?: DependencyFocus): DependencyEdgeProjection[] {
  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const reservedIds = new Set([
    ...graph.groups.map(({ id }) => id),
    ...graph.nodes.map(({ id }) => id),
    ...graph.edges.map(({ id }) => id),
  ]);
  const rootId = (node: DiagramNode): string => {
    if (!node.groupId) return node.id;
    let group: DiagramGroup = getOrThrow(groups.get(node.groupId), `Missing diagram group: ${node.groupId}`);
    while (group.parentId) group = getOrThrow(groups.get(group.parentId), `Missing diagram group: ${group.parentId}`);
    return group.id;
  };

  if (!focus) {
    // Without groups there is nothing to roll up: override the aggregate
    // default and show every relationship as its original edge instead of
    // pointless ×1 bundles.
    if (!groups.size) return graph.edges.map(({ id }) => ({ type: "original", edgeId: id }) as const);
    return aggregateEdges(
      graph.edges.map((edge) => ({
        edgeId: edge.id,
        sourceId: rootId(getOrThrow(nodes.get(edge.source), `Missing edge source: ${edge.source}`)),
        targetId: rootId(getOrThrow(nodes.get(edge.target), `Missing edge target: ${edge.target}`)),
      })),
      reservedIds,
    );
  }
  if (focus.type === "node") {
    getOrThrow(nodes.get(focus.id), `Missing focused diagram node: ${focus.id}`);
    return graph.edges
      .filter(({ source, target }) => source === focus.id || target === focus.id)
      .map(({ id }) => ({ type: "original", edgeId: id }));
  }
  if (focus.type === "aggregate") {
    const edgeIds = new Set(graph.edges.map(({ id }) => id));
    return focus.edgeIds.map((edgeId) => {
      if (!edgeIds.has(edgeId)) throw new Error(`Missing focused aggregate edge: ${edgeId}`);
      return { type: "original", edgeId };
    });
  }

  const focusedGroup = getOrThrow(groups.get(focus.id), `Missing focused diagram group: ${focus.id}`);
  const inside = new Set(
    graph.nodes.flatMap((node) => {
      let groupId = node.groupId;
      while (groupId) {
        if (groupId === focus.id) return [node.id];
        groupId = getOrThrow(groups.get(groupId), `Missing diagram group: ${groupId}`).parentId;
      }
      return [];
    }),
  );
  const originals: DependencyEdgeProjection[] = [];
  const boundary: BoundaryEdge[] = [];
  graph.edges.forEach((edge) => {
    const sourceInside = inside.has(edge.source);
    const targetInside = inside.has(edge.target);
    if (sourceInside && targetInside) {
      originals.push({ type: "original", edgeId: edge.id });
      return;
    }
    if (sourceInside === targetInside) return;
    const outside = getOrThrow(
      nodes.get(sourceInside ? edge.target : edge.source),
      `Missing boundary edge node: ${edge.id}`,
    );
    const outsideId = outside.groupId === focusedGroup.parentId ? outside.id : (outside.groupId ?? outside.id);
    boundary.push(
      sourceInside
        ? { edgeId: edge.id, sourceId: focus.id, targetId: outsideId }
        : { edgeId: edge.id, sourceId: outsideId, targetId: focus.id },
    );
  });
  return [...originals, ...aggregateEdges(boundary, reservedIds)];
}
