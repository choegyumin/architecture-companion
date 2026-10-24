import { MarkerType } from "@xyflow/react";
import { Focus, X } from "lucide-react";
import { useCallback, useState } from "react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import { type DiagramRendererProps, DiagramView } from "@/client/parts/diagram-view";
import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
} from "@/client/parts/diagram-view.react-flow";
import {
  collectVirtualBundles,
  type DependencyRoutingProjection,
  getDependencyElementBounds,
  getDependencyNodeBundleIds,
  layoutDependencyGraph,
  peelDependencyRootShell,
  routeAggregateDependencyEdges,
  routeNodeDependencyEdge,
  routeOriginalDependencyEdge,
} from "@/client/widgets/dependency-graph-diagram-renderer.layout";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { Artifact, DependencyGraphDiagram } from "@/features/artifact/artifact";
import { type DependencyDiagramGraph, diagramEdgeDisplay } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import type { BoundingGroupReactFlowNode } from "@/shared/react-flow/bounding-group-node";
import { ActiveIndicator } from "@/shared/react-flow/diagram-overlays";
import { Button } from "@/shared/react-ui/button";
import { ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/shared/react-ui/item";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type DependencyFocus =
  | Readonly<{ type: "group"; id: string }>
  | Readonly<{ type: "node"; id: string }>
  | Readonly<{ type: "aggregate"; edgeIds: readonly string[] }>;

export type DependencyEdgeProjection =
  | Readonly<{ type: "original"; edgeId: string }>
  | (DependencyRoutingProjection & Readonly<{ type: "aggregate"; edgeIds: readonly string[] }>);

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

export function projectDependencyEdges(
  graph: DependencyDiagramGraph,
  focus?: DependencyFocus,
): DependencyEdgeProjection[] {
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

type DependencyRenderOptions = Readonly<{
  focus?: DependencyFocus;
  nodesActivatable?: boolean;
  onAggregateActivate?: (edgeIds: readonly string[]) => void;
}>;

export function buildDependencyGraphDiagramReactFlowRenderModel(
  artifact: Artifact,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
  options: DependencyRenderOptions = {},
): DiagramReactFlowRenderModel {
  // The layout runs on the peeled view, so aggregation must see the same top
  // level; the stored artifact itself keeps the factual hierarchy.
  const graph = peelDependencyRootShell((artifact.diagram as DependencyGraphDiagram).graph);
  const nodes = buildDiagramReactFlowNodes(artifact, layout, onOpenSource, options.nodesActivatable);
  const bounds = getDependencyElementBounds(layout);
  const cards = layout.nodes.map(({ id }) => ({
    id,
    bounds: getOrThrow(bounds.get(id), `Missing dependency node bounds: ${id}`),
  }));
  const edgesById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const placementById = new Map(layout.edges.map((placement) => [placement.id, placement]));
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edgeTargets = new Map<string, AnnotationTarget>();
  const projections = projectDependencyEdges(graph, options.focus);
  const bundles = [...(collectVirtualBundles(layout, bounds) ?? [])];
  const groupIds = new Set([...layout.groups.map(({ id }) => id), ...bundles.map(([, { id }]) => id)]);
  const hasGroupEndpoint = (sourceId: string, targetId: string) => groupIds.has(sourceId) || groupIds.has(targetId);
  const aggregateProjections = projections
    .filter((projection) => projection.type === "aggregate")
    .filter((projection) => hasGroupEndpoint(projection.sourceId, projection.targetId));
  // Draw a loose-node outline only when a relationship explicitly targets that
  // bundle. Relationships to its parent group attach to the whole group instead.
  const attached = new Set(aggregateProjections.flatMap(({ sourceId, targetId }) => [sourceId, targetId]));
  const boundingGroups = bundles
    .filter(([, bundle]) => attached.has(bundle.id))
    .map<BoundingGroupReactFlowNode>(([groupId, bundle]) => {
      const group = getOrThrow(bounds.get(groupId), `Missing dependency group bounds: ${groupId}`);
      return {
        id: bundle.id,
        type: "bounding-group",
        data: {},
        position: { x: bundle.position.x - group.position.x, y: bundle.position.y - group.position.y },
        parentId: groupId,
        // Blocking the React Flow wrapper (not just the article) lets hover and
        // clicks fall through to the group underneath, so the bounding group
        // never intercepts interactions or hover effects.
        style: { width: bundle.size.width, height: bundle.size.height, pointerEvents: "none" },
        draggable: false,
        focusable: false,
        selectable: false,
      };
    });
  const layeredNodes = [
    ...nodes.filter((node) => node.type === "labeled-group"),
    ...boundingGroups,
    ...nodes.filter((node) => node.type !== "labeled-group"),
  ];
  const aggregateRoutes = routeAggregateDependencyEdges(aggregateProjections, layout);
  const edges = projections.map<DiagramReactFlowEdge>((projection) => {
    const common = {
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
      style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
      type: "connection" as const,
    };
    if (projection.type === "original") {
      const edge = getOrThrow(edgesById.get(projection.edgeId), `Missing dependency edge: ${projection.edgeId}`);
      const placement = getOrThrow(placementById.get(edge.edgeId), `Missing dependency edge route: ${edge.edgeId}`);
      const route = routeOriginalDependencyEdge(
        placement.points,
        getOrThrow(bounds.get(edge.sourceNodeId), `Missing dependency source: ${edge.sourceNodeId}`),
        getOrThrow(bounds.get(edge.targetNodeId), `Missing dependency target: ${edge.targetNodeId}`),
        cards.filter(({ id }) => id !== edge.sourceNodeId && id !== edge.targetNodeId).map(({ bounds }) => bounds),
      );
      const display = diagramEdgeDisplay(edge);
      return {
        ...common,
        id: edge.edgeId,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        ...(display.label ? { label: display.label } : {}),
        data: {
          ...route,
          ...(display.kind ? { eyebrow: display.kind } : {}),
          ...(display.href ? { href: display.href } : {}),
          onLinkActivate,
        },
      };
    }

    const edgeIds = [...projection.edgeIds];
    const route = hasGroupEndpoint(projection.sourceId, projection.targetId)
      ? getOrThrow(aggregateRoutes.get(projection.id), `Missing aggregate route: ${projection.id}`)
      : routeNodeDependencyEdge(
          getOrThrow(bounds.get(projection.sourceId), `Missing aggregate source: ${projection.sourceId}`),
          getOrThrow(bounds.get(projection.targetId), `Missing aggregate target: ${projection.targetId}`),
          cards
            .filter(({ id }) => id !== projection.sourceId && id !== projection.targetId)
            .map(({ bounds }) => bounds),
        );
    edgeTargets.set(projection.id, {
      type: "edge-set",
      sourceId: projection.sourceId,
      targetId: projection.targetId,
      edgeIds,
    });
    return {
      ...common,
      id: projection.id,
      source: projection.sourceId,
      target: projection.targetId,
      data: {
        ...route,
        eyebrow: `×${edgeIds.length}`,
        ...(options.onAggregateActivate
          ? {
              labelAction: {
                ariaLabel: `Show ${edgeIds.length} edges from ${projection.sourceId} to ${projection.targetId}`,
                onActivate: () => options.onAggregateActivate?.(edgeIds),
              },
            }
          : {}),
      },
    };
  });

  return { nodes: layeredNodes, edges, edgeTargets };
}

function calculateLayout(artifact: Artifact, nodeSizes: DiagramNodeSizes) {
  if (artifact.diagram.layout.layoutId !== "dependency-graph") throw new Error("Expected a dependency graph layout.");
  return layoutDependencyGraph((artifact.diagram as DependencyGraphDiagram).graph, nodeSizes);
}

function describeDependencyFocus(artifact: Artifact, focus: DependencyFocus): string {
  if (focus.type !== "aggregate") {
    const element =
      focus.type === "node"
        ? getOrThrow(
            artifact.diagram.graph.nodes.find((node) => node.nodeId === focus.id),
            `Missing focused diagram node: ${focus.id}`,
          )
        : getOrThrow(
            artifact.diagram.graph.groups.find((group) => group.groupId === focus.id),
            `Missing focused diagram group: ${focus.id}`,
          );
    return `Focused on ${element.title}`;
  }

  const firstEdgeId = focus.edgeIds.at(0);
  const nodesById = new Map(artifact.diagram.graph.nodes.map((node) => [node.nodeId, node]));
  const edge = getOrThrow(
    artifact.diagram.graph.edges.find((candidate) => candidate.edgeId === firstEdgeId),
    `Missing focused aggregate edge: ${firstEdgeId}`,
  );
  const source = getOrThrow(nodesById.get(edge.sourceNodeId), `Missing edge source: ${edge.sourceNodeId}`);
  const target = getOrThrow(nodesById.get(edge.targetNodeId), `Missing edge target: ${edge.targetNodeId}`);
  return `${focus.edgeIds.length} edges: ${source.title} → ${target.title}`;
}

export function DependencyGraphDiagramRenderer(props: DiagramRendererProps) {
  const [focus, setFocus] = useState<DependencyFocus>();
  const canFocus = !props.annotations.isManaging && !props.annotations.isPublishing;
  const buildRenderModel = useCallback(
    (artifact: Artifact, layout: DiagramLayout, onOpenSource: (href: string) => void) =>
      buildDependencyGraphDiagramReactFlowRenderModel(artifact, layout, onOpenSource, {
        focus,
        nodesActivatable: canFocus,
        ...(canFocus
          ? {
              onAggregateActivate: (edgeIds: readonly string[]) =>
                setFocus({ type: "aggregate", edgeIds: [...edgeIds] }),
            }
          : {}),
      }),
    [focus, canFocus],
  );

  return (
    <DiagramView
      {...props}
      activeIndicator={
        focus ? (
          <ActiveIndicator>
            <ItemMedia variant="icon">
              <Focus aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="max-w-md">{describeDependencyFocus(props.artifact, focus)}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button
                aria-label="Clear focus"
                className="-m-1.5 ml-0"
                onClick={() => setFocus(undefined)}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </ItemActions>
          </ActiveIndicator>
        ) : null
      }
      buildRenderModel={buildRenderModel}
      calculateLayout={calculateLayout}
      onGroupActivate={canFocus ? (id) => setFocus({ type: "group", id }) : undefined}
      onNodeActivate={canFocus ? (id) => setFocus({ type: "node", id }) : undefined}
      onPaneActivate={canFocus ? () => setFocus(undefined) : undefined}
    />
  );
}
