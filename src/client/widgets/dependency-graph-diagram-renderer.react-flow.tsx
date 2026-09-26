import { MarkerType } from "@xyflow/react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import {
  getDependencyElementBounds,
  routeNodeDependencyEdge,
  routeOriginalDependencyEdge,
} from "@/client/widgets/dependency-graph-edge-routes";
import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import { type DependencyFocus, projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type DependencyRenderOptions = Readonly<{
  focus?: DependencyFocus;
  nodesActivatable?: boolean;
  onAggregateActivate?: (edgeIds: readonly string[]) => void;
}>;

export function buildDependencyGraphDiagramReactFlowRenderModel(
  diagram: Diagram,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
  options: DependencyRenderOptions = {},
): DiagramReactFlowRenderModel {
  const nodes = buildDiagramReactFlowNodes(diagram, layout, onOpenSource, options.nodesActivatable);
  const bounds = getDependencyElementBounds(layout);
  const cards = layout.nodes.map(({ id }) => ({
    id,
    bounds: getOrThrow(bounds.get(id), `Missing dependency node bounds: ${id}`),
  }));
  const edgesById = new Map(diagram.graph.edges.map((edge) => [edge.id, edge]));
  const placementById = new Map(layout.edges.map((placement) => [placement.id, placement]));
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edgeTargets = new Map<string, AnnotationTarget>();
  const projections = projectDependencyEdges(diagram.graph, options.focus);
  const groupIds = new Set(layout.groups.map(({ id }) => id));
  const hasGroupEndpoint = (sourceId: string, targetId: string) => groupIds.has(sourceId) || groupIds.has(targetId);
  const aggregateProjections = projections
    .filter((projection) => projection.type === "aggregate")
    .filter((projection) => hasGroupEndpoint(projection.sourceId, projection.targetId));
  const aggregateRoutes = routeAggregateDependencyEdges(aggregateProjections, layout);
  const edges = projections.map<DiagramReactFlowEdge>((projection) => {
    const common = {
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
      style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
      type: "route" as const,
    };
    if (projection.type === "original") {
      const edge = getOrThrow(edgesById.get(projection.edgeId), `Missing dependency edge: ${projection.edgeId}`);
      const placement = getOrThrow(placementById.get(edge.id), `Missing dependency edge route: ${edge.id}`);
      const route = routeOriginalDependencyEdge(
        placement.points,
        getOrThrow(bounds.get(edge.source), `Missing dependency source: ${edge.source}`),
        getOrThrow(bounds.get(edge.target), `Missing dependency target: ${edge.target}`),
        cards.filter(({ id }) => id !== edge.source && id !== edge.target).map(({ bounds }) => bounds),
      );
      return {
        ...common,
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
        data: {
          ...route,
          ...(edge.kind ? { eyebrow: edge.kind } : {}),
          ...(edge.href ? { href: edge.href } : {}),
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

  return { nodes, edges, edgeTargets };
}
