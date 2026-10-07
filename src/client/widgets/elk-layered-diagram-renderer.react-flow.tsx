import { MarkerType } from "@xyflow/react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
  toMessageReactFlowEdge,
} from "@/client/widgets/diagram-renderer.react-flow";
import { toBezierPath, toPolylinePath, toSplinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";
import type { Artifact } from "@/features/artifact/artifact";
import { diagramEdgeDisplay } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutEdge } from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

function toEdgePath(placement: DiagramLayoutEdge): string {
  if (placement.routing === "spline") return toSplinePath(placement.points);
  if (placement.routing === "bezier") return toBezierPath(placement.points);
  return toPolylinePath(placement.points);
}

export function buildElkLayeredDiagramReactFlowRenderModel(
  diagram: Artifact,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowRenderModel {
  const nodes = buildDiagramReactFlowNodes(diagram, layout, onOpenSource);
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edges = layout.edges.map<DiagramReactFlowEdge>((placement) => {
    const edge = diagram.graph.edges.find(({ id }) => id === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
    if (edge.type === "message") return toMessageReactFlowEdge(edge, placement.points, onLinkActivate);
    const display = diagramEdgeDisplay(edge);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
      style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
      type: "route",
      ...(display.label ? { label: display.label } : {}),
      data: {
        path: toEdgePath(placement),
        labelPosition:
          placement.points.length > 1
            ? getPolylineEdgeLabelPlacement(placement.points)
            : (placement.points.at(0) ?? { x: 0, y: 0 }),
        ...(display.kind && display.kind !== "inline-render" ? { eyebrow: display.kind } : {}),
        ...(display.href ? { href: display.href } : {}),
        onLinkActivate,
      },
    };
  });

  return { nodes, edges };
}
