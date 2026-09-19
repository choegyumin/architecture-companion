import { z } from "zod";

import { type Diagram, diagramSchema } from "@/features/diagram/diagram";
import type { DefaultDiagramEdge, DefaultDiagramNode } from "@/features/diagram/diagram-graph";

export const artifactSchema = z
  .object({
    behaviors: z.array(diagramSchema),
    designs: z.array(diagramSchema),
  })
  .strict()
  .superRefine((artifact, context) => {
    const behaviorIds = new Set<string>();
    artifact.behaviors.forEach((diagram, index) => {
      if (behaviorIds.has(diagram.id)) {
        context.addIssue({
          code: "custom",
          path: ["behaviors", index, "id"],
          message: `Duplicate behavior ID: ${diagram.id}`,
        });
      }
      behaviorIds.add(diagram.id);
    });

    const designIds = new Set<string>();
    artifact.designs.forEach((diagram, index) => {
      if (designIds.has(diagram.id)) {
        context.addIssue({
          code: "custom",
          path: ["designs", index, "id"],
          message: `Duplicate design ID: ${diagram.id}`,
        });
      }
      designIds.add(diagram.id);
    });
  });

type BehaviorRepresentation = Omit<Diagram, "graph"> & {
  graph: Omit<Diagram["graph"], "nodes" | "edges"> & {
    nodes: readonly DefaultDiagramNode[];
    edges: readonly DefaultDiagramEdge[];
  };
};
type DesignRepresentation = Diagram;

type ParsedArtifact = z.infer<typeof artifactSchema>;
export type Artifact = Omit<ParsedArtifact, "behaviors" | "designs"> & {
  behaviors: readonly BehaviorRepresentation[];
  designs: readonly DesignRepresentation[];
};

export function parseArtifact(input: unknown): Artifact {
  const result = artifactSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid artifact: ${messages}`, { cause: result.error });
  }

  return result.data as Artifact;
}
