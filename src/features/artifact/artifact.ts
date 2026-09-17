import { z } from "zod";

import { type Diagram, diagramSchema } from "@/features/diagram/diagram";
import type { DefaultDiagramEdge, DefaultDiagramNode } from "@/features/diagram/diagram-graph";

export const artifactSchema = z
  .object({
    version: z.literal(1),
    processes: z.array(diagramSchema),
    designs: z.array(diagramSchema),
  })
  .strict()
  .superRefine((artifact, context) => {
    const processIds = new Set<string>();
    artifact.processes.forEach((diagram, index) => {
      if (processIds.has(diagram.id)) {
        context.addIssue({
          code: "custom",
          path: ["processes", index, "id"],
          message: `Duplicate process ID: ${diagram.id}`,
        });
      }
      processIds.add(diagram.id);
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

type ProcessRepresentation = Omit<Diagram, "graph"> & {
  graph: Omit<Diagram["graph"], "nodes" | "edges"> & {
    nodes: readonly DefaultDiagramNode[];
    edges: readonly DefaultDiagramEdge[];
  };
};
type DesignRepresentation = Diagram;

type ParsedArtifact = z.infer<typeof artifactSchema>;
export type Artifact = Omit<ParsedArtifact, "processes" | "designs"> & {
  processes: readonly ProcessRepresentation[];
  designs: readonly DesignRepresentation[];
};

export function parseArtifact(input: unknown): Artifact {
  // TODO: Add version migrations at this parsing boundary when a released spec needs compatibility.
  const result = artifactSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid artifact: ${messages}`, { cause: result.error });
  }

  return result.data as Artifact;
}
