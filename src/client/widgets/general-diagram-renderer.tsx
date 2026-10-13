import { MarkerType } from "@xyflow/react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import { type DiagramRendererProps, DiagramView } from "@/client/parts/diagram-view";
import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
  toMessageReactFlowEdge,
} from "@/client/parts/diagram-view.react-flow";
import { layoutGeneralDiagram } from "@/client/widgets/general-diagram-renderer.layout";
import { type Artifact, isGeneralArtifact } from "@/features/artifact/artifact";
import { diagramEdgeDisplay } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutEdge, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { toBezierPath, toPolylinePath, toSplinePath } from "@/shared/react-flow/edge-paths";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

function calculateLayout(artifact: Artifact, nodeSizes: DiagramNodeSizes) {
  if (!isGeneralArtifact(artifact)) throw new Error("Expected a general diagram layout.");
  return layoutGeneralDiagram(artifact.diagram.graph, nodeSizes, artifact.diagram.layout.options);
}

function toEdgePath(placement: DiagramLayoutEdge): string {
  if (placement.routing === "spline") return toSplinePath(placement.points);
  if (placement.routing === "bezier") return toBezierPath(placement.points);
  return toPolylinePath(placement.points);
}

export function buildGeneralDiagramReactFlowRenderModel(
  artifact: Artifact,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowRenderModel {
  const nodes = buildDiagramReactFlowNodes(artifact, layout, onOpenSource);
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edges = layout.edges.map<DiagramReactFlowEdge>((placement) => {
    const edge = artifact.diagram.graph.edges.find(({ edgeId }) => edgeId === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
    if (edge.type === "message") return toMessageReactFlowEdge(edge, placement.points, onLinkActivate);
    const display = diagramEdgeDisplay(edge);

    return {
      id: edge.edgeId,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
      style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
      type: "connection",
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

export function GeneralDiagramRenderer(props: DiagramRendererProps) {
  return (
    <DiagramView
      {...props}
      calculateLayout={calculateLayout}
      buildRenderModel={buildGeneralDiagramReactFlowRenderModel}
    />
  );
}
