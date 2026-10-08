import z from "zod";

import type { DependencyGraphDiagram, Diagram, ElkLayeredDiagram, SequenceDiagram } from "@/features/artifact/artifact";
import {
  componentStructureDiagramLayoutConfigSchema,
  layoutComponentStructureDiagram,
} from "@/features/diagram/_layout/component-structure-diagram-layout";
import {
  dependencyGraphLayoutConfigSchema,
  layoutDependencyGraph,
} from "@/features/diagram/_layout/dependency-graph-layout";
import {
  elkLayeredDiagramLayoutConfigSchema,
  layoutElkLayeredDiagram,
} from "@/features/diagram/_layout/elk-layered-diagram-layout";
import {
  layoutSequenceDiagram,
  sequenceDiagramLayoutConfigSchema,
} from "@/features/diagram/_layout/sequence-diagram-layout";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

export const diagramLayoutConfigSchema = z.discriminatedUnion("id", [
  elkLayeredDiagramLayoutConfigSchema,
  sequenceDiagramLayoutConfigSchema,
  dependencyGraphLayoutConfigSchema,
  componentStructureDiagramLayoutConfigSchema,
]);
export type DiagramLayoutConfig = z.infer<typeof diagramLayoutConfigSchema>;

// Layout ids sit one level below the diagram pair's root, so plain `switch`
// cannot discriminate the pairing; these guards carry the comparison instead.
function isElkLayeredDiagramInput(diagram: Diagram): diagram is ElkLayeredDiagram {
  return diagram.layout.id === "elk-layered";
}

function isSequenceDiagramInput(diagram: Diagram): diagram is SequenceDiagram {
  return diagram.layout.id === "sequence";
}

function isDependencyGraphDiagramInput(diagram: Diagram): diagram is DependencyGraphDiagram {
  return diagram.layout.id === "dependency-graph";
}

export function layoutDiagram(diagram: Diagram, nodeSizes: DiagramNodeSizes): Promise<DiagramLayout> {
  if (isElkLayeredDiagramInput(diagram)) {
    return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
  }
  if (isSequenceDiagramInput(diagram)) return layoutSequenceDiagram(diagram.graph, nodeSizes);
  if (isDependencyGraphDiagramInput(diagram)) return layoutDependencyGraph(diagram.graph, nodeSizes);
  // Decision nodes and split segments are display projections, so the stored
  // graph is projected before the layout places it.
  return layoutComponentStructureDiagram(projectDecisionNodes(diagram.graph), nodeSizes, diagram.layout.options);
}
