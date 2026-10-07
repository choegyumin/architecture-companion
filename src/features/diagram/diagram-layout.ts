import z from "zod";

import type {
  ComponentStructureArtifact,
  DependencyGraphArtifact,
  ElkLayeredArtifact,
  SequenceArtifact,
} from "@/features/artifact/artifact";
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

/** A layout paired with the graph contract it stores - comparing `layout.id` narrows the graph. */
export type DiagramLayoutInput =
  | Pick<ElkLayeredArtifact, "graph" | "layout">
  | Pick<SequenceArtifact, "graph" | "layout">
  | Pick<DependencyGraphArtifact, "graph" | "layout">
  | Pick<ComponentStructureArtifact, "graph" | "layout">;

// Layout ids sit one level below the member root, so plain `switch` cannot
// discriminate the pairing; these guards carry the comparison instead.
function isElkLayeredInput(diagram: DiagramLayoutInput): diagram is Pick<ElkLayeredArtifact, "graph" | "layout"> {
  return diagram.layout.id === "elk-layered";
}

function isSequenceInput(diagram: DiagramLayoutInput): diagram is Pick<SequenceArtifact, "graph" | "layout"> {
  return diagram.layout.id === "sequence";
}

function isDependencyGraphInput(
  diagram: DiagramLayoutInput,
): diagram is Pick<DependencyGraphArtifact, "graph" | "layout"> {
  return diagram.layout.id === "dependency-graph";
}

export function layoutDiagram(diagram: DiagramLayoutInput, nodeSizes: DiagramNodeSizes): Promise<DiagramLayout> {
  if (isElkLayeredInput(diagram)) return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
  if (isSequenceInput(diagram)) return layoutSequenceDiagram(diagram.graph, nodeSizes);
  if (isDependencyGraphInput(diagram)) return layoutDependencyGraph(diagram.graph, nodeSizes);
  // Decision nodes and split segments are display projections, so the stored
  // graph is projected before the layout places it.
  return layoutComponentStructureDiagram(projectDecisionNodes(diagram.graph), nodeSizes, diagram.layout.options);
}
