import { getDependencyNodeBundleIds } from "@/features/diagram/dependency-node-bundle";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";
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

function createEdgeAggregator(reservedIds: ReadonlySet<string>) {
  const byEndpoints = new Map<string, string[]>();
  const usedIds = new Set(reservedIds);
  const projections: DependencyEdgeProjection[] = [];
  return {
    projections,
    add(edgeId: string, sourceId: string, targetId: string) {
      if (sourceId === targetId) return;
      const key = JSON.stringify([sourceId, targetId]);
      const existing = byEndpoints.get(key);
      if (existing) {
        existing.push(edgeId);
        return;
      }
      let id = `aggregate:${key}`;
      while (usedIds.has(id)) id += ":";
      usedIds.add(id);
      const edgeIds = [edgeId];
      byEndpoints.set(key, edgeIds);
      projections.push({ type: "aggregate", id, sourceId, targetId, edgeIds });
    },
  };
}

export function projectDependencyEdges(graph: DiagramGraph, focus?: DependencyFocus): DependencyEdgeProjection[] {
  const groups = new Map(graph.groups.map((group) => [group.groupId, group]));
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const reservedIds = new Set([
    ...graph.groups.map(({ groupId }) => groupId),
    ...graph.nodes.map(({ nodeId }) => nodeId),
    ...graph.edges.map(({ edgeId }) => edgeId),
  ]);
  if (!focus) {
    // Without groups there is nothing to roll up: override the aggregate
    // default and show every relationship as its original edge instead of
    // pointless ×1 aggregate edges.
    if (!groups.size) return graph.edges.map(({ edgeId }) => ({ type: "original", edgeId }) as const);
    const bundles = getDependencyNodeBundleIds(groups.keys(), reservedIds);
    const pathsByGroup = new Map<string | undefined, readonly string[]>([[undefined, []]]);
    const ancestors = new Map(
      graph.nodes.map((node) => {
        let path = pathsByGroup.get(node.groupId);
        if (!path) {
          const missing: string[] = [];
          let groupId = node.groupId;
          while (groupId && !pathsByGroup.has(groupId)) {
            missing.push(groupId);
            groupId = getOrThrow(groups.get(groupId), `Missing diagram group: ${groupId}`).parentGroupId;
          }
          path = pathsByGroup.get(groupId)!;
          for (const id of missing.reverse()) {
            path = [...path, id];
            pathsByGroup.set(id, path);
          }
        }
        return [node.nodeId, path] as const;
      }),
    );
    const overview = createEdgeAggregator(new Set([...reservedIds, ...bundles.values()]));
    graph.edges.forEach((edge) => {
      const source = getOrThrow(ancestors.get(edge.sourceNodeId), `Missing edge source: ${edge.sourceNodeId}`);
      const target = getOrThrow(ancestors.get(edge.targetNodeId), `Missing edge target: ${edge.targetNodeId}`);
      let depth = 0;
      while (depth < source.length && depth < target.length && source[depth] === target[depth]) depth += 1;
      const parentId = depth ? source[depth - 1] : undefined;
      // Each relationship belongs to its lowest common scope, not every ancestor.
      // Direct nodes share one bundle there; its internal detail remains focused-only.
      if (parentId && depth === source.length && depth === target.length) return;
      overview.add(
        edge.edgeId,
        source[depth] ?? (parentId ? bundles.get(parentId)! : edge.sourceNodeId),
        target[depth] ?? (parentId ? bundles.get(parentId)! : edge.targetNodeId),
      );
    });
    return overview.projections;
  }
  if (focus.type === "node") {
    getOrThrow(nodes.get(focus.id), `Missing focused diagram node: ${focus.id}`);
    return graph.edges
      .filter(({ sourceNodeId, targetNodeId }) => sourceNodeId === focus.id || targetNodeId === focus.id)
      .map(({ edgeId }) => ({ type: "original", edgeId }));
  }
  if (focus.type === "aggregate") {
    const edgeIds = new Set(graph.edges.map(({ edgeId }) => edgeId));
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
        if (groupId === focus.id) return [node.nodeId];
        groupId = getOrThrow(groups.get(groupId), `Missing diagram group: ${groupId}`).parentGroupId;
      }
      return [];
    }),
  );
  const originals: DependencyEdgeProjection[] = [];
  const boundary = createEdgeAggregator(reservedIds);
  graph.edges.forEach((edge) => {
    const sourceInside = inside.has(edge.sourceNodeId);
    const targetInside = inside.has(edge.targetNodeId);
    if (sourceInside && targetInside) {
      originals.push({ type: "original", edgeId: edge.edgeId });
      return;
    }
    if (sourceInside === targetInside) return;
    const outside = getOrThrow(
      nodes.get(sourceInside ? edge.targetNodeId : edge.sourceNodeId),
      `Missing boundary edge node: ${edge.edgeId}`,
    );
    const outsideId =
      outside.groupId === focusedGroup.parentGroupId ? outside.nodeId : (outside.groupId ?? outside.nodeId);
    boundary.add(edge.edgeId, sourceInside ? focus.id : outsideId, sourceInside ? outsideId : focus.id);
  });
  return [...originals, ...boundary.projections];
}
