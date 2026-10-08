import { z } from "zod";

import { annotationTargetSchema } from "@/features/annotation/annotation-document";
import { artifactIdSchema } from "@/features/artifact/artifact";
import type { CompanionCatalog } from "@/features/catalog/catalog";

export const spotlightDiagramViewSchema = z
  .object({
    elements: z.array(annotationTargetSchema),
  })
  .strict();

export const artifactSpotlightSchema = z
  .object({
    artifactId: artifactIdSchema,
    diagram: spotlightDiagramViewSchema,
  })
  .strict();

export type SpotlightDiagramView = z.infer<typeof spotlightDiagramViewSchema>;
export type ArtifactSpotlight = z.infer<typeof artifactSpotlightSchema>;

export function parseArtifactSpotlight(input: unknown): ArtifactSpotlight {
  const result = artifactSpotlightSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid artifact spotlight: ${messages}`, { cause: result.error });
  }

  return result.data;
}

export type SpotlightValidation = Readonly<{ status: "ok" }> | Readonly<{ status: "invalid"; message: string }>;

export function validateSpotlightAgainstCatalog(
  catalog: CompanionCatalog,
  spotlight: ArtifactSpotlight,
): SpotlightValidation {
  const artifact =
    catalog.behaviors.find(({ id }) => id === spotlight.artifactId) ??
    catalog.designs.find(({ id }) => id === spotlight.artifactId);
  if (!artifact) {
    return { status: "invalid", message: `Spotlight references an unknown artifact: ${spotlight.artifactId}` };
  }

  const groupIds = new Set(artifact.diagram.graph.groups.map(({ id }) => id));
  const nodeIds = new Set(artifact.diagram.graph.nodes.map(({ id }) => id));
  const edgeIds = new Set(artifact.diagram.graph.edges.map(({ id }) => id));
  const endpointIds = new Set([...groupIds, ...nodeIds]);

  const problems: string[] = [];
  for (const element of spotlight.diagram.elements) {
    if (element.type === "group" && !groupIds.has(element.id)) {
      problems.push(`Unknown diagram group: ${element.id}`);
    }
    if (element.type === "node" && !nodeIds.has(element.id)) {
      problems.push(`Unknown diagram node: ${element.id}`);
    }
    if (element.type === "edge" && !edgeIds.has(element.id)) {
      problems.push(`Unknown diagram edge: ${element.id}`);
    }
    if (element.type === "edge-set") {
      if (!endpointIds.has(element.sourceId) || !endpointIds.has(element.targetId)) {
        problems.push(
          `Edge-set endpoints must be existing groups or nodes: from ${element.sourceId} to ${element.targetId}`,
        );
      }
      for (const edgeId of element.edgeIds) {
        if (!edgeIds.has(edgeId)) problems.push(`Unknown diagram edge: ${edgeId}`);
      }
    }
  }

  if (problems.length > 0) {
    return {
      status: "invalid",
      message: `Spotlight does not match artifact ${spotlight.artifactId}: ${problems.join("; ")}`,
    };
  }

  return { status: "ok" };
}
