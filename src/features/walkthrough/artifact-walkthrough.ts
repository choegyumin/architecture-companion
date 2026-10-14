import { z } from "zod";

import { type AnnotationTarget, annotationTargetSchema } from "@/features/annotation/annotation-document";
import { artifactIdSchema } from "@/features/artifact/artifact";
import type { CompanionCatalog } from "@/features/catalog/catalog";

// The URL carries a walkthrough as its raw JSON in base64url, uncompressed.
// Anything that fails to decode or parse is quietly dropped by the caller.
const walkthroughStepSchema = z
  .object({
    // Steps reuse the Annotation target contract. A step may address nothing:
    // it shows its caption as explanation only, with no highlighting and no
    // camera target.
    elements: z.array(annotationTargetSchema),
    // The schema requires a caption to be present but leaves its content open,
    // including an empty one; whether a step explains itself is agent policy
    // stated in the skill instructions, not something the server enforces.
    caption: z.string(),
  })
  .strict();

const walkthroughDiagramViewSchema = z
  .object({
    steps: z.array(walkthroughStepSchema).min(1),
  })
  .strict();

export const artifactWalkthroughSchema = z
  .object({
    artifactId: artifactIdSchema,
    diagram: walkthroughDiagramViewSchema,
  })
  .strict();

// Declared structurally with readonly collections so callers may hold frozen
// fixtures; zod's inferred output stays assignable to this view.
export type ArtifactWalkthrough = Readonly<{
  artifactId: string;
  diagram: Readonly<{
    steps: readonly Readonly<{ elements: readonly AnnotationTarget[]; caption: string }>[];
  }>;
}>;

export function parseArtifactWalkthrough(input: unknown): ArtifactWalkthrough {
  const result = artifactWalkthroughSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message, path }) => {
      const field = path
        .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
        .join("");
      return field.length > 0 ? `${field.slice(1)}: ${message}` : message;
    });
    throw new Error(`Invalid artifact walkthrough: ${messages.join("; ")}`, { cause: result.error });
  }

  return result.data;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function encodeArtifactWalkthrough(walkthrough: ArtifactWalkthrough): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(walkthrough)));
}

export function decodeArtifactWalkthrough(param: string): ArtifactWalkthrough | undefined {
  // Only canonical, unpadded base64url decodes; padded or otherwise
  // non-canonical params are dropped like any other malformed input.
  if (!/^[A-Za-z0-9_-]+$/.test(param)) return undefined;

  try {
    const base64 = param.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return parseArtifactWalkthrough(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

export type WalkthroughValidation = Readonly<{ status: "ok" }> | Readonly<{ status: "invalid"; message: string }>;

export function validateWalkthroughAgainstCatalog(
  catalog: CompanionCatalog,
  walkthrough: ArtifactWalkthrough,
): WalkthroughValidation {
  const artifact = catalog.artifacts.find(({ artifactId }) => artifactId === walkthrough.artifactId);
  if (!artifact) {
    return { status: "invalid", message: `Walkthrough references an unknown artifact: ${walkthrough.artifactId}` };
  }

  const groupIds = new Set(artifact.diagram.graph.groups.map(({ groupId }) => groupId));
  const nodeIds = new Set(artifact.diagram.graph.nodes.map(({ nodeId }) => nodeId));
  const edgeIds = new Set(artifact.diagram.graph.edges.map(({ edgeId }) => edgeId));
  const endpointIds = new Set([...groupIds, ...nodeIds]);

  const problems: string[] = [];
  walkthrough.diagram.steps.forEach((step, stepIndex) => {
    const stepLabel = `Step ${stepIndex + 1}`;
    for (const element of step.elements) {
      if (element.type === "group" && !groupIds.has(element.id)) {
        problems.push(`${stepLabel}: unknown diagram group: ${element.id}`);
      }
      if (element.type === "node" && !nodeIds.has(element.id)) {
        problems.push(`${stepLabel}: unknown diagram node: ${element.id}`);
      }
      if (element.type === "edge" && !edgeIds.has(element.id)) {
        problems.push(`${stepLabel}: unknown diagram edge: ${element.id}`);
      }
      if (element.type === "edge-set") {
        if (!endpointIds.has(element.sourceId) || !endpointIds.has(element.targetId)) {
          problems.push(
            `${stepLabel}: edge-set endpoints must be existing groups or nodes: from ${element.sourceId} to ${element.targetId}`,
          );
        }
        for (const edgeId of element.edgeIds) {
          if (!edgeIds.has(edgeId)) problems.push(`${stepLabel}: unknown diagram edge: ${edgeId}`);
        }
      }
    }
  });

  if (problems.length > 0) {
    return {
      status: "invalid",
      message: `Walkthrough does not match artifact ${walkthrough.artifactId}: ${problems.join("; ")}`,
    };
  }

  return { status: "ok" };
}
