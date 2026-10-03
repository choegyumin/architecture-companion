import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildSequenceDiagramReactFlowRenderModel } from "@/client/widgets/sequence-diagram-renderer.react-flow";
import { layoutSequenceDiagram } from "@/features/diagram/_layout/sequence-diagram-layout";
import type { Artifact } from "@/features/diagram/artifact";
import type { DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "sequence") throw new Error("Expected a sequence diagram layout.");
  return layoutSequenceDiagram(diagram.graph, nodeSizes);
}

export function SequenceDiagramRenderer(props: DiagramRendererProps) {
  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildRenderModel={buildSequenceDiagramReactFlowRenderModel}
    />
  );
}
