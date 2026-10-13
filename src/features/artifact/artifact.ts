import { z } from "zod";

import {
  type ArtifactGeneratorReference,
  artifactGeneratorReferenceSchema,
} from "@/features/artifact-generator/artifact-generator-reference";
import {
  componentStructureDiagramGraphSchema,
  dependencyDiagramGraphSchema,
  diagramLinkSchema,
  flowchartDiagramGraphSchema,
  generalDiagramGraphSchema,
  sequenceDiagramGraphSchema,
  toDiagramGraphInput,
} from "@/features/diagram/diagram-graph";
import {
  componentStructureDiagramLayoutConfigSchema,
  dependencyGraphLayoutConfigSchema,
  generalDiagramLayoutConfigSchema,
  sequenceDiagramLayoutConfigSchema,
} from "@/features/diagram/diagram-layout";

export const artifactIdSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !/^[a-zA-Z]:/.test(path) &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Artifact ID must be a scope-relative file path with forward slashes",
  );

// The envelope holds an artifact's authoring and regeneration context; the
// varying part is the single `diagram` field below, so every envelope field
// is declared once.
const artifactBaseShape = {
  type: z.enum(["behavior", "design"]),
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
// each member carries both, so comparing `layout.layoutId` narrows the graph type.
// zod cannot discriminate on the nested `layout.layoutId` path, so this is a plain
// union - a failure reports issues from every member instead of one.
const diagramMemberSchema = <Layout extends z.ZodTypeAny, Graph extends z.ZodTypeAny>(layout: Layout, graph: Graph) =>
  z.object({ layout, graph }).strict();

export const generalDiagramSchema = diagramMemberSchema(generalDiagramLayoutConfigSchema, generalDiagramGraphSchema);
// The flowchart generator narrows the general layout's graph contract, so its
// member pairs the same layout configuration with the flowchart graph schema.
export const flowchartDiagramSchema = diagramMemberSchema(
  generalDiagramLayoutConfigSchema,
  flowchartDiagramGraphSchema,
);
export const sequenceDiagramSchema = diagramMemberSchema(sequenceDiagramLayoutConfigSchema, sequenceDiagramGraphSchema);
export const dependencyGraphDiagramSchema = diagramMemberSchema(
  dependencyGraphLayoutConfigSchema,
  dependencyDiagramGraphSchema,
);
export const componentStructureDiagramSchema = diagramMemberSchema(
  componentStructureDiagramLayoutConfigSchema,
  componentStructureDiagramGraphSchema,
);

export type GeneralDiagram = z.infer<typeof generalDiagramSchema>;
export type FlowchartDiagram = z.infer<typeof flowchartDiagramSchema>;
export type SequenceDiagram = z.infer<typeof sequenceDiagramSchema>;
export type DependencyGraphDiagram = z.infer<typeof dependencyGraphDiagramSchema>;
export type ComponentStructureDiagram = z.infer<typeof componentStructureDiagramSchema>;
export type Diagram = z.infer<typeof diagramSchema>;

export const diagramSchema = z.union([
  generalDiagramSchema,
  flowchartDiagramSchema,
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
export type ArtifactDocument = Omit<ParsedArtifact, "generator"> & {
  generator: ArtifactGeneratorReference;
};
export type Artifact = ArtifactDocument & { artifactId: string };

/** Serialize normalized values without writing defaults back into authored JSON. */
export function toArtifactDocumentInput(document: ArtifactDocument) {
  const layout = document.diagram.layout;
  const inputLayout =
    layout.layoutId === "general" && layout.options
      ? {
          ...layout,
          options: {
            ...(layout.options.elk ? { elk: layout.options.elk } : {}),
            ...(layout.options.nudgeObstacleNodes ? { nudgeObstacleNodes: true } : {}),
            ...(layout.options.bezierEdges ? { bezierEdges: true } : {}),
          },
        }
      : layout;
  return {
    ...document,
    diagram: { layout: inputLayout, graph: toDiagramGraphInput(document.diagram.graph) },
  };
}

// Layout ids sit inside the `diagram` pair, so plain comparisons do not
// narrow the artifact's diagram union; these guards carry the pairing instead.
export function isGeneralArtifact(artifact: Artifact): artifact is Artifact & { diagram: GeneralDiagram } {
  return artifact.diagram.layout.layoutId === "general";
}

export function isSequenceArtifact(artifact: Artifact): artifact is Artifact & { diagram: SequenceDiagram } {
  return artifact.diagram.layout.layoutId === "sequence";
}

export function isComponentStructureArtifact(
  artifact: Artifact,
): artifact is Artifact & { diagram: ComponentStructureDiagram } {
  return artifact.diagram.layout.layoutId === "component-structure";
}

// zod cannot discriminate on the nested `layout.layoutId` path, and a plain union
// reports only "Invalid input" on failure. Parsing dispatches on the layout
// id first so failures carry the matching member's specific issues; the full
// schema still runs afterwards to report envelope problems under their own
// paths. A generator that narrows a layout shared with other generators is
// dispatched by `generator` instead, because every such artifact shares one
// layout id.
const diagramMembersByLayoutId = {
  general: generalDiagramSchema,
  sequence: sequenceDiagramSchema,
  "dependency-graph": dependencyGraphDiagramSchema,
  "component-structure": componentStructureDiagramSchema,
} as const;
const diagramMembersByGenerator = {
  "built-in:flowchart": flowchartDiagramSchema,
} as const;

function toIssueMessages(error: z.ZodError): string {
  return error.issues
    .map(({ message, path }) => (path.length > 0 ? `${path.join(".")}: ${message}` : message))
    .join("; ");
}

export function parseArtifact(input: unknown): ArtifactDocument {
  const generator = (input as { generator?: unknown } | null)?.generator;
  const layout = (input as { diagram?: { layout?: { layoutId?: unknown } } } | null)?.diagram?.layout;
  const member =
    (typeof generator === "string"
      ? diagramMembersByGenerator[generator as keyof typeof diagramMembersByGenerator]
      : undefined) ??
    (layout != null && typeof layout === "object" && typeof layout.layoutId === "string"
      ? diagramMembersByLayoutId[layout.layoutId as keyof typeof diagramMembersByLayoutId]
      : undefined);
  if (member === undefined && layout != null && typeof layout === "object" && typeof layout.layoutId === "string") {
    // An unknown layout id has no member to report against; name it directly.
    throw new Error(`Invalid artifact: diagram.layout.layoutId: Unsupported layout configuration: ${layout.layoutId}`);
  }
  if (member !== undefined) {
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
  return result.data as ArtifactDocument;
}
