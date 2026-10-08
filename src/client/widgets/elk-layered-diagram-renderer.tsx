import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import type { Artifact } from "@/features/artifact/artifact";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(artifact: Artifact, nodeSizes: DiagramNodeSizes) {
  if (artifact.diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(artifact.diagram.graph, nodeSizes, artifact.diagram.layout.options);
}

export function ElkLayeredDiagramRenderer(props: DiagramRendererProps) {
  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildRenderModel={buildElkLayeredDiagramReactFlowRenderModel}
    />
  );
}
