import { ComponentStructureDiagramRenderer } from "@/client/widgets/component-structure-diagram-renderer";
import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import type { DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { ElkLayeredDiagramRenderer } from "@/client/widgets/elk-layered-diagram-renderer";
import { SequenceDiagramRenderer } from "@/client/widgets/sequence-diagram-renderer";
import { hasComponentStructure } from "@/features/diagram/diagram-graph";

export function DiagramRenderer(props: DiagramRendererProps) {
  switch (props.diagram.layout.id) {
    case "dependency-graph":
      return <DependencyGraphDiagramRenderer key={JSON.stringify(props.diagram)} {...props} />;
    case "elk-layered":
      return hasComponentStructure(props.diagram.graph) ? (
        <ComponentStructureDiagramRenderer {...props} />
      ) : (
        <ElkLayeredDiagramRenderer {...props} />
      );
    case "sequence":
      return <SequenceDiagramRenderer {...props} />;
  }
}
