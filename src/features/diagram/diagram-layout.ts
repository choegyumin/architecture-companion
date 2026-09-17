import z from "zod";

import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import { layoutSequenceDiagram } from "@/features/diagram/_layout/sequence-diagram-layout";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

import { elkLayeredDiagramLayoutConfigSchema } from "./_layout/elk-layered-diagram-layout";
import { sequenceDiagramLayoutConfigSchema } from "./_layout/sequence-diagram-layout";

export const diagramLayoutConfigSchema = z.discriminatedUnion("id", [
  elkLayeredDiagramLayoutConfigSchema,
  sequenceDiagramLayoutConfigSchema,
]);
export type DiagramLayoutConfig = z.infer<typeof diagramLayoutConfigSchema>;

export function layoutDiagram(
  diagram: Readonly<{ graph: DiagramGraph; layout: DiagramLayoutConfig }>,
  nodeSizes: DiagramNodeSizes,
): Promise<DiagramLayout> {
  switch (diagram.layout.id) {
    case "elk-layered":
      return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
    case "sequence":
      return layoutSequenceDiagram(diagram.graph, nodeSizes);
  }
}
