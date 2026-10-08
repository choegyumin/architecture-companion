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

export const artifactIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Artifact ID must be lowercase kebab-case (letters, digits, hyphens)");

// The envelope holds an artifact's authoring and regeneration context; the
// varying part is the single `diagram` field below, so every envelope field
// is declared once.
const artifactBaseShape = {
  id: artifactIdSchema,
  title: z.string().min(1),
  updatedAt: z.string().datetime(),
  vcs: z
    .object({
      revision: z.string().min(1),
      divergesFromRevision: z.boolean(),
    })
    .strict()
    .optional(),
  generator: artifactGeneratorReferenceSchema,
  instructions: z.string().min(1),
  links: z.array(diagramLinkSchema).readonly().optional(),
};

// One layout-graph pair: the layout decides which graph contract applies, and
// each member carries both, so comparing `layout.id` narrows the graph type.
// zod cannot discriminate on the nested `layout.id` path, so this is a plain
// union - a failure reports issues from every member instead of one.
const diagramMemberSchema = <Layout extends z.ZodTypeAny, Graph extends z.ZodTypeAny>(layout: Layout, graph: Graph) =>
  z.object({ layout, graph }).strict();

export const elkLayeredDiagramSchema = diagramMemberSchema(elkLayeredDiagramLayoutConfigSchema, diagramGraphSchema);
export const sequenceDiagramSchema = diagramMemberSchema(sequenceDiagramLayoutConfigSchema, sequenceDiagramGraphSchema);
export const dependencyGraphDiagramSchema = diagramMemberSchema(
  dependencyGraphLayoutConfigSchema,
  dependencyDiagramGraphSchema,
);
export const componentStructureDiagramSchema = diagramMemberSchema(
  componentStructureDiagramLayoutConfigSchema,
  componentStructureDiagramGraphSchema,
);

export type ElkLayeredDiagram = z.infer<typeof elkLayeredDiagramSchema>;
export type SequenceDiagram = z.infer<typeof sequenceDiagramSchema>;
export type DependencyGraphDiagram = z.infer<typeof dependencyGraphDiagramSchema>;
export type ComponentStructureDiagram = z.infer<typeof componentStructureDiagramSchema>;
export type Diagram = z.infer<typeof diagramSchema>;

export const diagramSchema = z.union([
  elkLayeredDiagramSchema,
  sequenceDiagramSchema,
  dependencyGraphDiagramSchema,
  componentStructureDiagramSchema,
]);

export const artifactSchema = z
  .object({
    ...artifactBaseShape,
    diagram: diagramSchema,
  })
  .strict();

type ParsedArtifact = z.infer<typeof artifactSchema>;
export type Artifact = Omit<ParsedArtifact, "generator"> & {
  generator: ArtifactGeneratorReference;
};

// Layout ids sit inside the `diagram` pair, so plain comparisons do not
// narrow the artifact's diagram union; these guards carry the pairing instead.
export function isElkLayeredArtifact(artifact: Artifact): artifact is Artifact & { diagram: ElkLayeredDiagram } {
  return artifact.diagram.layout.id === "elk-layered";
}

export function isComponentStructureArtifact(
  artifact: Artifact,
): artifact is Artifact & { diagram: ComponentStructureDiagram } {
  return artifact.diagram.layout.id === "component-structure";
}

// zod cannot discriminate on the nested `layout.id` path, and a plain union
// reports only "Invalid input" on failure. Parsing dispatches on the layout
// id first so failures carry the matching member's specific issues; the full
// schema still runs afterwards to report envelope problems under their own
// paths.
const diagramMembersByLayoutId = {
  "elk-layered": elkLayeredDiagramSchema,
  sequence: sequenceDiagramSchema,
  "dependency-graph": dependencyGraphDiagramSchema,
  "component-structure": componentStructureDiagramSchema,
} as const;

function toIssueMessages(error: z.ZodError): string {
  return error.issues
    .map(({ message, path }) => (path.length > 0 ? `${path.join(".")}: ${message}` : message))
    .join("; ");
}

export function parseArtifact(input: unknown): Artifact {
  const layout = (input as { diagram?: { layout?: { id?: unknown } } } | null)?.diagram?.layout;
  if (layout != null && typeof layout === "object" && typeof layout.id === "string") {
    const member = diagramMembersByLayoutId[layout.id as keyof typeof diagramMembersByLayoutId];
    // An unknown layout id has no member to report against; name it directly.
    if (member === undefined) {
      throw new Error(`Invalid artifact: diagram.layout.id: Unsupported layout configuration: ${layout.id}`);
    }
    const diagram = (input as { diagram?: unknown }).diagram;
    const diagramResult = member.safeParse(diagram);
    if (!diagramResult.success) {
      const issues = new z.ZodError(
        diagramResult.error.issues.map((issue) => ({ ...issue, path: ["diagram", ...issue.path] })),
      );
      throw new Error(`Invalid artifact: ${toIssueMessages(issues)}`, { cause: issues });
    }
  }

  const result = artifactSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid artifact: ${toIssueMessages(result.error)}`, { cause: result.error });
  }
  return result.data as Artifact;
}
