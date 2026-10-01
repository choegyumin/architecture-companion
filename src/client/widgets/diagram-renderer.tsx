import { ComponentCompositionPrototype } from "@/client/widgets/component-composition.prototype";
import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import type { DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { ElkLayeredDiagramRenderer } from "@/client/widgets/elk-layered-diagram-renderer";
import { SequenceDiagramRenderer } from "@/client/widgets/sequence-diagram-renderer";

// PROTOTYPE wiring — evaluated once at module load, dev builds only.
const isComponentCompositionPrototypeVariant =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("variant") === "component-composition";

export function DiagramRenderer(props: DiagramRendererProps) {
  if (isComponentCompositionPrototypeVariant && props.diagram.id === "component-structure") {
    return <ComponentCompositionPrototype {...props} />;
  }
  switch (props.diagram.layout.id) {
    case "dependency-graph":
      return <DependencyGraphDiagramRenderer key={JSON.stringify(props.diagram)} {...props} />;
    case "elk-layered":
      return <ElkLayeredDiagramRenderer {...props} />;
    case "sequence":
      return <SequenceDiagramRenderer {...props} />;
  }
}
