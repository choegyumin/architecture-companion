import { ComponentStructureDiagramRenderer } from "@/client/widgets/component-structure-diagram-renderer";
import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import type { DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { ElkLayeredDiagramRenderer } from "@/client/widgets/elk-layered-diagram-renderer";
import { SequenceDiagramRenderer } from "@/client/widgets/sequence-diagram-renderer";

export function DiagramRenderer(props: DiagramRendererProps) {
  switch (props.artifact.diagram.layout.id) {
    case "dependency-graph":
      return <DependencyGraphDiagramRenderer key={JSON.stringify(props.artifact)} {...props} />;
    case "elk-layered":
      return <ElkLayeredDiagramRenderer {...props} />;
    case "sequence":
      return <SequenceDiagramRenderer {...props} />;
    case "component-structure":
      return <ComponentStructureDiagramRenderer {...props} />;
  }
}
