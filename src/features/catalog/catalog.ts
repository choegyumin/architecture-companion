import { z } from "zod";

import { artifactStem, type Artifact, artifactIdSchema, parseArtifact } from "@/features/artifact/artifact";

export const catalogConfigSchema = z
  .object({
    include: z.array(z.string().min(1)).default(["**/*.archcomp.json"]),
    instructions: z.string().optional(),
  })
  .strict();

export type CatalogConfig = z.infer<typeof catalogConfigSchema>;

// Catalog artifacts parse through `parseArtifact`, which dispatches on the
// layout id and reports the matching member's specific issues; a plain
// `z.array(artifactSchema)` would flatten the union into "Invalid input".
const companionCatalogShapeSchema = z
  .object({
    artifacts: z.array(z.unknown()).readonly(),
  })
  .strict();

const catalogEntrySchema = z.object({ artifactId: artifactIdSchema }).passthrough();

export type CompanionCatalog = Readonly<{
  artifacts: readonly Artifact[];
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
    catalog = { artifacts: shape.data.artifacts.map(parseEntry) };
  } catch (error) {
    throw new Error(`Invalid catalog: ${error instanceof Error ? error.message : "Unknown artifact shape"}`, {
      cause: error,
    });
  }

  const issues: string[] = [];
  const ids = new Set<string>();
  const stems = new Set<string>();
  for (const artifact of catalog.artifacts) {
    if (ids.has(artifact.artifactId)) issues.push(`Duplicate artifact path: ${artifact.artifactId}`);
    ids.add(artifact.artifactId);
    // The stem is the URL key, so two artifacts sharing a file name would
    // claim the same URL.
    const stem = artifactStem(artifact.artifactId);
    if (stems.has(stem)) issues.push(`Duplicate artifact stem: ${stem}`);
    stems.add(stem);
  }
  if (issues.length > 0) throw new Error(`Invalid catalog: ${issues.join("; ")}`);

  return catalog;
}
