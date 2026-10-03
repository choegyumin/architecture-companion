import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { Artifact } from "@/features/diagram/artifact";
import type { DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
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
