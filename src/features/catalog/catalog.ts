import { z } from "zod";

import { type Artifact, artifactIdSchema, parseArtifact } from "@/features/artifact/artifact";

export const catalogConfigSchema = z
  .object({
    artifactPatterns: z.array(z.string().min(1)).default(["**/*.archcomp.json"]),
    placementInstructions: z.string().min(1).optional(),
  })
  .strict();

export type CatalogConfig = z.infer<typeof catalogConfigSchema>;

// Catalog artifacts parse through `parseArtifact`, which dispatches on the
// layout id and reports the matching member's specific issues; a plain
// `z.array(artifactSchema)` would flatten the union into "Invalid input".
const companionCatalogShapeSchema = z
  .object({
    behaviors: z.array(z.unknown()).readonly(),
    designs: z.array(z.unknown()).readonly(),
  })
  .strict();

const catalogEntrySchema = z.object({ artifactId: artifactIdSchema }).passthrough();

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
  const parseEntry = (input: unknown): Artifact => {
    const { artifactId, ...document } = catalogEntrySchema.parse(input);
    return { ...parseArtifact(document), artifactId };
  };
  try {
    catalog = {
      behaviors: shape.data.behaviors.map(parseEntry),
      designs: shape.data.designs.map(parseEntry),
    };
  } catch (error) {
    throw new Error(`Invalid catalog: ${error instanceof Error ? error.message : "Unknown artifact shape"}`, {
      cause: error,
    });
  }

  const issues: string[] = [];
  const ids = new Set<string>();
  for (const [kind, artifacts] of [
    ["behavior", catalog.behaviors],
    ["design", catalog.designs],
  ] as const) {
    for (const artifact of artifacts) {
      if (artifact.kind !== kind) {
        issues.push(`Artifact kind does not match ${kind} collection: ${artifact.artifactId}`);
      }
      if (ids.has(artifact.artifactId)) issues.push(`Duplicate artifact path: ${artifact.artifactId}`);
      ids.add(artifact.artifactId);
    }
  }
  if (issues.length > 0) throw new Error(`Invalid catalog: ${issues.join("; ")}`);

  return catalog;
}
