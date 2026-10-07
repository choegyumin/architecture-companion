import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import type { DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { ElkLayeredDiagramRenderer } from "@/client/widgets/elk-layered-diagram-renderer";
import { SequenceDiagramRenderer } from "@/client/widgets/sequence-diagram-renderer";

export function DiagramRenderer(props: DiagramRendererProps) {
  switch (props.diagram.layout.id) {
    case "dependency-graph":
      return <DependencyGraphDiagramRenderer key={JSON.stringify(props.diagram)} {...props} />;
    case "elk-layered":
      return <ElkLayeredDiagramRenderer {...props} />;
    case "sequence":
      return <SequenceDiagramRenderer {...props} />;
    case "component-structure":
      // The component structure renderer lands with its widgets; no artifact
      // uses this layout until the generator emits it.
      throw new Error("Component structure renderer is not implemented yet.");
  }
}
