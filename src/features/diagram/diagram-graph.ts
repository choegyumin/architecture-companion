import { z } from "zod";

/* === ID === */

export const diagramIdSchema = z.string().min(1);

/* === Link === */

export const diagramLinkSchema = z
  .object({
    text: z.string().min(1).optional(),
    href: z.string().min(1),
  })
  .strict();
export type DiagramLink = z.infer<typeof diagramLinkSchema>;

/* === Component structure === */

const componentPathRequirementSchema = z.object({ controlId: diagramIdSchema, value: z.string().min(1) }).strict();
export const componentPathsSchema = z.array(z.array(componentPathRequirementSchema)).min(1);
export type ComponentPaths = z.infer<typeof componentPathsSchema>;

const componentControlBaseShape = {
  id: diagramIdSchema,
  source: diagramIdSchema,
  label: z.string().min(1),
  when: componentPathsSchema,
};
export const componentControlSchema = z.discriminatedUnion("kind", [
  z.object({ ...componentControlBaseShape, kind: z.literal("conditional") }).strict(),
  z
    .object({
      ...componentControlBaseShape,
      kind: z.literal("branch"),
      alternatives: z.array(z.object({ id: diagramIdSchema, label: z.string().min(1) }).strict()).min(2),
    })
    .strict(),
]);
export type ComponentControl = z.infer<typeof componentControlSchema>;

const componentNodeMetadataSchema = z
  .object({
    definitionId: diagramIdSchema,
    origins: z.array(
      z.object({ supplierId: diagramIdSchema, supplierTitle: z.string().min(1), prop: z.string().min(1) }).strict(),
    ),
  })
  .strict();

/* === Node === */

const diagramNodeBaseShape = {
  id: diagramIdSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  details: z.array(z.string().min(1)).optional(),
  groupId: diagramIdSchema.optional(),
};

export const defaultDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    kind: z.string().min(1).optional(),
    type: z.literal("default"),
    links: z.array(diagramLinkSchema).optional(),
    component: componentNodeMetadataSchema.optional(),
  })
  .strict();
export type DefaultDiagramNode = z.infer<typeof defaultDiagramNodeSchema>;

const activationEndpointSchema = z
  .object({
    messageId: diagramIdSchema,
    endpoint: z.enum(["source", "target"]),
  })
  .strict();
const activationSchema = z
  .object({
    id: diagramIdSchema,
    startsAt: activationEndpointSchema,
    endsAt: activationEndpointSchema,
  })
  .strict();
export const lifelineDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    kind: z.string().min(1),
    type: z.literal("lifeline"),
    links: z.array(diagramLinkSchema).optional(),
    activations: z.array(activationSchema),
  })
  .strict();
export type LifelineDiagramNode = z.infer<typeof lifelineDiagramNodeSchema>;

const fragmentBranchSchema = z
  .object({
    id: diagramIdSchema,
    guard: z.string().min(1),
    startMessageId: diagramIdSchema,
    endMessageId: diagramIdSchema,
  })
  .strict();
export const fragmentDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    kind: z.string().min(1),
    type: z.literal("fragment"),
    operator: z.enum(["alt", "opt", "loop", "par", "break", "critical", "assert", "neg"]),
    branches: z.array(fragmentBranchSchema).min(1),
  })
  .strict();
export type FragmentDiagramNode = z.infer<typeof fragmentDiagramNodeSchema>;

export const diagramNodeSchema = z.discriminatedUnion("type", [
  defaultDiagramNodeSchema,
  lifelineDiagramNodeSchema,
  fragmentDiagramNodeSchema,
]);
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

/* === Edge === */

export const defaultDiagramEdgeSchema = z
  .object({
    id: diagramIdSchema,
    type: z.literal("default"),
    source: diagramIdSchema,
    target: diagramIdSchema,
    kind: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    href: z.string().min(1).optional(),
    component: z.object({ paths: componentPathsSchema }).strict().optional(),
  })
  .strict();
export type DefaultDiagramEdge = z.infer<typeof defaultDiagramEdgeSchema>;

export const messageDiagramEdgeSchema = z
  .object({
    id: diagramIdSchema,
    type: z.literal("message"),
    source: diagramIdSchema,
    target: diagramIdSchema,
    kind: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    href: z.string().min(1).optional(),
    messageType: z.enum(["sync", "async", "return"]).default("sync"),
  })
  .strict();
export type MessageDiagramEdge = z.infer<typeof messageDiagramEdgeSchema>;

export const diagramEdgeSchema = z.discriminatedUnion("type", [defaultDiagramEdgeSchema, messageDiagramEdgeSchema]);
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

/* === Group === */

export const diagramGroupSchema = z
  .object({
    id: diagramIdSchema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    parentId: diagramIdSchema.optional(),
  })
  .strict();
export type DiagramGroup = z.infer<typeof diagramGroupSchema>;

/* === Graph === */

export const diagramGraphSchema = z
  .object({
    groups: z.array(diagramGroupSchema).readonly(),
    nodes: z.array(diagramNodeSchema).min(1).readonly(),
    edges: z.array(diagramEdgeSchema).readonly(),
    componentStructure: z
      .object({ roots: z.array(diagramIdSchema).min(1), controls: z.array(componentControlSchema) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((graph, context) => {
    const controls = new Map(graph.componentStructure?.controls.map((control) => [control.id, control]));
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const rootIds = new Set<string>();
    graph.componentStructure?.roots.forEach((root, index) => {
      if (!nodeIds.has(root) || rootIds.has(root)) {
        context.addIssue({
          code: "custom",
          path: ["componentStructure", "roots", index],
          message: `${nodeIds.has(root) ? "Duplicate" : "Unknown"} component root: ${root}`,
        });
      }
      rootIds.add(root);
    });
    const controlIds = new Set<string>();
    graph.componentStructure?.controls.forEach((control, index) => {
      if (controlIds.has(control.id)) {
        context.addIssue({
          code: "custom",
          path: ["componentStructure", "controls", index, "id"],
          message: `Duplicate component control: ${control.id}`,
        });
      }
      controlIds.add(control.id);
      if (!nodeIds.has(control.source)) {
        context.addIssue({
          code: "custom",
          path: ["componentStructure", "controls", index, "source"],
          message: `Unknown component control source: ${control.source}`,
        });
      }
      if (control.kind === "branch") {
        const alternativeIds = new Set<string>();
        control.alternatives.forEach((alternative, alternativeIndex) => {
          if (alternativeIds.has(alternative.id)) {
            context.addIssue({
              code: "custom",
              path: ["componentStructure", "controls", index, "alternatives", alternativeIndex, "id"],
              message: `Duplicate component alternative: ${alternative.id}`,
            });
          }
          alternativeIds.add(alternative.id);
        });
      }
    });
    const validatePaths = (paths: ComponentPaths, path: (string | number)[]) => {
      paths.forEach((requirements, pathIndex) => {
        const values = new Map<string, string>();
        requirements.forEach((requirement, requirementIndex) => {
          const previous = values.get(requirement.controlId);
          if (previous !== undefined && previous !== requirement.value) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, requirementIndex],
              message: `Contradictory component path: ${requirement.controlId}`,
            });
          }
          values.set(requirement.controlId, requirement.value);
          const control = controls.get(requirement.controlId);
          if (!control) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, requirementIndex, "controlId"],
              message: `Unknown component control: ${requirement.controlId}`,
            });
          } else if (
            control.kind === "conditional"
              ? requirement.value !== "on" && requirement.value !== "off"
              : !control.alternatives.some((alternative) => alternative.id === requirement.value)
          ) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, requirementIndex, "value"],
              message: `Invalid value for component control ${requirement.controlId}: ${requirement.value}`,
            });
          }
        });
      });
    };
    graph.edges.forEach((edge, index) => {
      if (edge.type === "default" && edge.component)
        validatePaths(edge.component.paths, ["edges", index, "component", "paths"]);
    });
    graph.componentStructure?.controls.forEach((control, index) => {
      validatePaths(control.when, ["componentStructure", "controls", index, "when"]);
    });
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const path of controls.get(id)?.when ?? []) {
        for (const requirement of path) if (hasCycle(requirement.controlId)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...controls.keys()].some(hasCycle)) {
      context.addIssue({
        code: "custom",
        path: ["componentStructure", "controls"],
        message: "Component control prerequisites contain a cycle",
      });
    }
  });
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;
