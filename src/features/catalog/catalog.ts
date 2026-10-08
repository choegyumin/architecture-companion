import { z } from "zod";

import { type Artifact, parseArtifact } from "@/features/artifact/artifact";

// Catalog artifacts parse through `parseArtifact`, which dispatches on the
// layout id and reports the matching member's specific issues; a plain
// `z.array(artifactSchema)` would flatten the union into "Invalid input".
const companionCatalogShapeSchema = z
  .object({
    behaviors: z.array(z.unknown()).readonly(),
    designs: z.array(z.unknown()).readonly(),
  })
  .strict();

export type CompanionCatalog = Readonly<{
  behaviors: readonly Artifact[];
  designs: readonly Artifact[];
}>;

export function parseCatalog(input: unknown): CompanionCatalog {
  const shape = companionCatalogShapeSchema.safeParse(input);
  if (!shape.success) {
    const messages = shape.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid catalog: ${messages}`, { cause: shape.error });
  }

  let catalog: CompanionCatalog;
  try {
    catalog = {
      behaviors: shape.data.behaviors.map(parseArtifact),
      designs: shape.data.designs.map(parseArtifact),
    };
  } catch (error) {
    throw new Error(`Invalid catalog: ${error instanceof Error ? error.message : "Unknown artifact shape"}`, {
      cause: error,
    });
  }

  const issues: string[] = [];
  for (const [kind, artifacts] of [
    ["behavior", catalog.behaviors],
    ["design", catalog.designs],
  ] as const) {
    const ids = new Set<string>();
    for (const artifact of artifacts) {
      if (ids.has(artifact.id)) issues.push(`Duplicate ${kind} ID: ${artifact.id}`);
      ids.add(artifact.id);
    }
  }
  if (issues.length > 0) throw new Error(`Invalid catalog: ${issues.join("; ")}`);

  return catalog;
}
