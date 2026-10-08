import { z } from "zod";

import {
  type ArtifactGeneratorReference,
  artifactGeneratorReferenceSchema,
} from "@/features/artifact-generator/artifact-generator-reference";
import { componentStructureDiagramLayoutConfigSchema } from "@/features/diagram/_layout/component-structure-diagram-layout";
import { dependencyGraphLayoutConfigSchema } from "@/features/diagram/_layout/dependency-graph-layout";
import { elkLayeredDiagramLayoutConfigSchema } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import { sequenceDiagramLayoutConfigSchema } from "@/features/diagram/_layout/sequence-diagram-layout";
import {
  componentStructureDiagramGraphSchema,
  dependencyDiagramGraphSchema,
  diagramGraphSchema,
  diagramLinkSchema,
  sequenceDiagramGraphSchema,
} from "@/features/diagram/diagram-graph";

// The `id` values double as the generated JSON Schema `$defs` names, so the
// envelope fields shared by every union member render once and are referenced.
export const artifactIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Artifact ID must be lowercase kebab-case (letters, digits, hyphens)")
  .meta({ id: "ArtifactId" });

const artifactBaseShape = {
  id: artifactIdSchema,
  title: z.string().min(1),
  updatedAt: z.string().datetime().meta({ id: "UpdatedAt" }),
  vcs: z
    .object({
      revision: z.string().min(1),
      divergesFromRevision: z.boolean(),
    })
    .strict()
    .optional()
    .meta({ id: "Vcs" }),
  generator: artifactGeneratorReferenceSchema,
  instructions: z.string().min(1),
  links: z.array(diagramLinkSchema).readonly().optional().meta({ id: "Links" }),
};

// One layout-graph pair: the layout decides which graph contract applies, and
// each member carries both, so comparing `layout.id` narrows the graph type.
// zod cannot discriminate on the nested `layout.id` path, so this is a plain
// union - a failure reports issues from every member instead of one.
const artifactMemberSchema = <Layout extends z.ZodTypeAny, Graph extends z.ZodTypeAny>(layout: Layout, graph: Graph) =>
  z.object({ ...artifactBaseShape, layout, graph }).strict();

export const elkLayeredArtifactSchema = artifactMemberSchema(elkLayeredDiagramLayoutConfigSchema, diagramGraphSchema);
export const sequenceArtifactSchema = artifactMemberSchema(
  sequenceDiagramLayoutConfigSchema,
  sequenceDiagramGraphSchema,
);
export const dependencyGraphArtifactSchema = artifactMemberSchema(
  dependencyGraphLayoutConfigSchema,
  dependencyDiagramGraphSchema,
);
export const componentStructureArtifactSchema = artifactMemberSchema(
  componentStructureDiagramLayoutConfigSchema,
  componentStructureDiagramGraphSchema,
);

type ArtifactMember<Schema extends z.ZodTypeAny> = DistributiveOmit<z.infer<Schema>, "generator"> & {
  generator: ArtifactGeneratorReference;
};

export type ElkLayeredArtifact = ArtifactMember<typeof elkLayeredArtifactSchema>;
export type SequenceArtifact = ArtifactMember<typeof sequenceArtifactSchema>;
export type DependencyGraphArtifact = ArtifactMember<typeof dependencyGraphArtifactSchema>;
export type ComponentStructureArtifact = ArtifactMember<typeof componentStructureArtifactSchema>;

// Layout ids sit one level below the member root, so plain comparisons do
// not narrow the artifact union; these guards carry the pairing instead.
export function isElkLayeredArtifact(artifact: Artifact): artifact is ElkLayeredArtifact {
  return artifact.layout.id === "elk-layered";
}

export function isComponentStructureArtifact(artifact: Artifact): artifact is ComponentStructureArtifact {
  return artifact.layout.id === "component-structure";
}

export const artifactSchema = z.union([
  elkLayeredArtifactSchema,
  sequenceArtifactSchema,
  dependencyGraphArtifactSchema,
  componentStructureArtifactSchema,
]);

type ParsedArtifact = z.infer<typeof artifactSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Artifact = DistributiveOmit<ParsedArtifact, "generator"> & {
  generator: ArtifactGeneratorReference;
};

// zod cannot discriminate on the nested `layout.id` path, and a plain union
// reports only "Invalid input" on failure. Parsing dispatches on the layout
// id first so failures carry the matching member's specific issues.
const artifactMembersByLayoutId = {
  "elk-layered": elkLayeredArtifactSchema,
  sequence: sequenceArtifactSchema,
  "dependency-graph": dependencyGraphArtifactSchema,
  "component-structure": componentStructureArtifactSchema,
} as const;

function toIssueMessages(error: z.ZodError): string {
  return error.issues
    .map(({ message, path }) => (path.length > 0 ? `${path.join(".")}: ${message}` : message))
    .join("; ");
}

export function parseArtifact(input: unknown): Artifact {
  const layout = (input as { layout?: { id?: unknown } } | null)?.layout;
  if (layout != null && typeof layout === "object" && typeof layout.id === "string") {
    const member = artifactMembersByLayoutId[layout.id as keyof typeof artifactMembersByLayoutId];
    // An unknown layout id has no member to report against; name it directly.
    if (member === undefined) {
      throw new Error(`Invalid artifact: layout.id: Unsupported layout configuration: ${layout.id}`);
    }
    const result = member.safeParse(input);
    if (!result.success) {
      throw new Error(`Invalid artifact: ${toIssueMessages(result.error)}`, { cause: result.error });
    }
    return result.data as Artifact;
  }

  const result = artifactSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid artifact: ${toIssueMessages(result.error)}`, { cause: result.error });
  }
  return result.data as Artifact;
}
