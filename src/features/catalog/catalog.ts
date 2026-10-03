import { z } from "zod";

import { type Artifact, artifactSchema } from "@/features/diagram/artifact";
import type { DefaultDiagramEdge, DefaultDiagramNode } from "@/features/diagram/diagram-graph";

export const companionCatalogSchema = z
  .object({
    behaviors: z.array(artifactSchema),
    designs: z.array(artifactSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const behaviorIds = new Set<string>();
    catalog.behaviors.forEach((artifact, index) => {
      if (behaviorIds.has(artifact.id)) {
        context.addIssue({
          code: "custom",
          path: ["behaviors", index, "id"],
          message: `Duplicate behavior ID: ${artifact.id}`,
        });
      }
      behaviorIds.add(artifact.id);
    });

    const designIds = new Set<string>();
    catalog.designs.forEach((artifact, index) => {
      if (designIds.has(artifact.id)) {
        context.addIssue({
          code: "custom",
          path: ["designs", index, "id"],
          message: `Duplicate design ID: ${artifact.id}`,
        });
      }
      designIds.add(artifact.id);
    });
  });

type BehaviorRepresentation = Omit<Artifact, "graph"> & {
  graph: Omit<Artifact["graph"], "nodes" | "edges"> & {
    nodes: readonly DefaultDiagramNode[];
    edges: readonly DefaultDiagramEdge[];
  };
};
type DesignRepresentation = Artifact;

type ParsedCompanionCatalog = z.infer<typeof companionCatalogSchema>;
export type CompanionCatalog = Omit<ParsedCompanionCatalog, "behaviors" | "designs"> & {
  behaviors: readonly BehaviorRepresentation[];
  designs: readonly DesignRepresentation[];
};

export function parseCatalog(input: unknown): CompanionCatalog {
  const result = companionCatalogSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid catalog: ${messages}`, { cause: result.error });
  }

  return result.data as CompanionCatalog;
}
