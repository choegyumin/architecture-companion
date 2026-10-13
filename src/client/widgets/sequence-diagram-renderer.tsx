import { type DiagramRendererProps, DiagramView } from "@/client/parts/diagram-view";
import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  type DiagramReactFlowRenderModel,
  toMessageReactFlowEdge,
} from "@/client/parts/diagram-view.react-flow";
import { layoutSequenceDiagram } from "@/client/widgets/sequence-diagram-renderer.layout";
import { type Artifact, isSequenceArtifact } from "@/features/artifact/artifact";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import type { ConnectionReactFlowEdge } from "@/shared/react-flow/connection-edge";

function calculateLayout(artifact: Artifact, nodeSizes: DiagramNodeSizes) {
  if (!isSequenceArtifact(artifact)) throw new Error("Expected a sequence diagram layout.");
  return layoutSequenceDiagram(artifact.diagram.graph, nodeSizes);
}

export function buildSequenceDiagramReactFlowRenderModel(
  artifact: Artifact,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowRenderModel {
  const nodes = buildDiagramReactFlowNodes(artifact, layout, onOpenSource);
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edges = layout.edges.map<ConnectionReactFlowEdge>((placement) => {
    const edge = artifact.diagram.graph.edges.find(({ edgeId }) => edgeId === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
    if (edge.type !== "message") throw new Error(`Sequence layout references a non-message edge: ${edge.edgeId}`);
    return toMessageReactFlowEdge(edge, placement.points, onLinkActivate);
  });

  return { nodes, edges };
}

export function SequenceDiagramRenderer(props: DiagramRendererProps) {
  return (
    <DiagramView
      {...props}
      calculateLayout={calculateLayout}
      buildRenderModel={buildSequenceDiagramReactFlowRenderModel}
    />
  );
}
