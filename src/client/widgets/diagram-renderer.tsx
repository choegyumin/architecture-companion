import type { DiagramRendererProps } from "@/client/parts/diagram-view";
import { ComponentStructureDiagramRenderer } from "@/client/widgets/component-structure-diagram-renderer";
import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import { GeneralDiagramRenderer } from "@/client/widgets/general-diagram-renderer";
import { SequenceDiagramRenderer } from "@/client/widgets/sequence-diagram-renderer";

export function DiagramRenderer(props: DiagramRendererProps) {
  switch (props.artifact.diagram.layout.layoutId) {
    case "dependency-graph":
      return <DependencyGraphDiagramRenderer key={JSON.stringify(props.artifact)} {...props} />;
    case "general":
      return <GeneralDiagramRenderer {...props} />;
    case "sequence":
      return <SequenceDiagramRenderer {...props} />;
    case "component-structure":
      return <ComponentStructureDiagramRenderer {...props} />;
  }
}
