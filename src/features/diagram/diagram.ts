import { z } from "zod";

import { diagramGraphSchema, diagramLinkSchema } from "@/features/diagram/diagram-graph";
import { diagramLayoutConfigSchema } from "@/features/diagram/diagram-layout";
import {
  type DiagramGeneratorReference,
  diagramGeneratorReferenceSchema,
} from "@/features/diagram-generator/diagram-generator-reference";

export const artifactDiagramIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Diagram ID must be lowercase kebab-case (letters, digits, hyphens)");

export const diagramSchema = z
  .object({
    id: artifactDiagramIdSchema,
    title: z.string().min(1),
    generator: diagramGeneratorReferenceSchema,
    generatorInstructions: z.string().min(1).optional(),
    layout: diagramLayoutConfigSchema,
    links: z.array(diagramLinkSchema).readonly().optional(),
    graph: diagramGraphSchema,
  })
  .strict()
  .superRefine((diagram, context) => {
    if (diagram.layout.id === "sequence" && diagram.graph.groups.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["graph", "groups"],
        message: "Sequence layout does not support diagram groups",
      });
    }
    if (diagram.layout.id === "sequence" && !diagram.graph.nodes.some((node) => node.type === "lifeline")) {
      context.addIssue({
        code: "custom",
        path: ["graph", "nodes"],
        message: "Sequence layout requires at least one lifeline",
      });
    }
    if (diagram.layout.id === "sequence") {
      diagram.graph.nodes.forEach((node, index) => {
        if (node.type !== "lifeline" && node.type !== "fragment") {
          context.addIssue({
            code: "custom",
            path: ["graph", "nodes", index, "type"],
            message: "Sequence layout supports only lifeline and fragment nodes",
          });
        }
      });
      diagram.graph.edges.forEach((edge, index) => {
        if (edge.type !== "message") {
          context.addIssue({
            code: "custom",
            path: ["graph", "edges", index, "type"],
            message: "Sequence layout supports only message edges",
          });
        }
      });
    }

    const graphElements = [
      ...diagram.graph.groups.map((element, index) => ({
        element,
        path: ["graph", "groups", index, "id"] as const,
      })),
      ...diagram.graph.nodes.map((element, index) => ({
        element,
        path: ["graph", "nodes", index, "id"] as const,
      })),
      ...diagram.graph.edges.map((element, index) => ({
        element,
        path: ["graph", "edges", index, "id"] as const,
      })),
    ];
    graphElements.forEach(({ element, path }, index) => {
      if (graphElements.findIndex(({ element: candidate }) => candidate.id === element.id) !== index) {
        context.addIssue({
          code: "custom",
          path: [...path],
          message: `Duplicate diagram element ID: ${element.id}`,
        });
      }
    });

    const groupIds = new Set(diagram.graph.groups.map(({ id }) => id));
    const nodeById = new Map(diagram.graph.nodes.map((node) => [node.id, node]));
    const groupById = Object.fromEntries(diagram.graph.groups.map((group) => [group.id, group]));
    const messageEdges = diagram.graph.edges.filter((edge) => edge.type === "message");
    const messageById = new Map(messageEdges.map((edge) => [edge.id, edge]));
    const messageIndexes = new Map(messageEdges.map((edge, index) => [edge.id, index]));

    diagram.graph.groups.forEach((group, index) => {
      if (group.parentId && !groupIds.has(group.parentId)) {
        context.addIssue({
          code: "custom",
          path: ["graph", "groups", index, "parentId"],
          message: `Diagram group ${group.id} has unknown parent ${group.parentId}`,
        });
      }
    });

    const containsGroupCycle = (groupId: string, ancestors: readonly string[]): boolean => {
      const group = groupById[groupId];
      if (!group?.parentId) return false;
      if (ancestors.includes(group.parentId)) return true;
      return containsGroupCycle(group.parentId, [...ancestors, group.parentId]);
    };

    if (diagram.graph.groups.some(({ id }) => containsGroupCycle(id, [id]))) {
      context.addIssue({
        code: "custom",
        path: ["graph", "groups"],
        message: "Diagram group hierarchy contains a cycle",
      });
    }

    diagram.graph.nodes.forEach((node, index) => {
      if (node.groupId && !groupIds.has(node.groupId)) {
        context.addIssue({
          code: "custom",
          path: ["graph", "nodes", index, "groupId"],
          message: `Diagram node ${node.id} belongs to unknown group ${node.groupId}`,
        });
      }

      if (node.type === "lifeline") {
        const activationIds = new Set<string>();
        node.activations.forEach((activation, activationIndex) => {
          if (activationIds.has(activation.id)) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", index, "activations", activationIndex, "id"],
              message: `Duplicate activation ID: ${activation.id}`,
            });
          }
          activationIds.add(activation.id);

          for (const [boundaryName, boundary] of [
            ["startsAt", activation.startsAt],
            ["endsAt", activation.endsAt],
          ] as const) {
            const message = messageById.get(boundary.messageId);
            if (!message) {
              context.addIssue({
                code: "custom",
                path: ["graph", "nodes", index, "activations", activationIndex, boundaryName, "messageId"],
                message: `Activation ${activation.id} references unknown message ${boundary.messageId}`,
              });
              continue;
            }

            const endpointNodeId = boundary.endpoint === "source" ? message.source : message.target;
            if (endpointNodeId !== node.id) {
              context.addIssue({
                code: "custom",
                path: ["graph", "nodes", index, "activations", activationIndex, boundaryName],
                message: `Activation ${activation.id} ${boundaryName} does not belong to lifeline ${node.id}`,
              });
            }
          }

          const startIndex = messageIndexes.get(activation.startsAt.messageId);
          const endIndex = messageIndexes.get(activation.endsAt.messageId);
          if (startIndex !== undefined && endIndex !== undefined && startIndex > endIndex) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", index, "activations", activationIndex],
              message: `Activation ${activation.id} ends before it starts`,
            });
          }
        });
      }

      if (node.type === "fragment") {
        const branchIds = new Set<string>();
        node.branches.forEach((branch, branchIndex) => {
          if (branchIds.has(branch.id)) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", index, "branches", branchIndex, "id"],
              message: `Duplicate fragment branch ID: ${branch.id}`,
            });
          }
          branchIds.add(branch.id);

          const startIndex = messageIndexes.get(branch.startMessageId);
          const endIndex = messageIndexes.get(branch.endMessageId);
          if (startIndex === undefined || endIndex === undefined) {
            if (startIndex === undefined) {
              context.addIssue({
                code: "custom",
                path: ["graph", "nodes", index, "branches", branchIndex, "startMessageId"],
                message: `Fragment branch ${branch.id} references unknown message ${branch.startMessageId}`,
              });
            }
            if (endIndex === undefined) {
              context.addIssue({
                code: "custom",
                path: ["graph", "nodes", index, "branches", branchIndex, "endMessageId"],
                message: `Fragment branch ${branch.id} references unknown message ${branch.endMessageId}`,
              });
            }
          } else if (startIndex > endIndex) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", index, "branches", branchIndex],
              message: `Fragment branch ${branch.id} ends before it starts`,
            });
          }
        });
      }
    });

    diagram.graph.edges.forEach((edge, index) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source) {
        context.addIssue({
          code: "custom",
          path: ["graph", "edges", index, "source"],
          message: `Diagram edge ${edge.id} sources unknown node ${edge.source}`,
        });
      }
      if (!target) {
        context.addIssue({
          code: "custom",
          path: ["graph", "edges", index, "target"],
          message: `Diagram edge ${edge.id} targets unknown node ${edge.target}`,
        });
      }
      if (edge.type === "message") {
        if (source?.type !== "lifeline") {
          context.addIssue({
            code: "custom",
            path: ["graph", "edges", index, "source"],
            message: `Message edge ${edge.id} source must be a lifeline`,
          });
        }
        if (target?.type !== "lifeline") {
          context.addIssue({
            code: "custom",
            path: ["graph", "edges", index, "target"],
            message: `Message edge ${edge.id} target must be a lifeline`,
          });
        }
      }
    });
  });

type ParsedDiagram = z.infer<typeof diagramSchema>;
export type Diagram = Omit<ParsedDiagram, "generator"> & {
  generator: DiagramGeneratorReference;
};

export function parseDiagram(input: unknown): Diagram {
  const result = diagramSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid diagram: ${messages}`, { cause: result.error });
  }

  return result.data as Diagram;
}
