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

/** One condition of a control path: the control `controlId` must currently hold `value`. */
const diagramControlConditionSchema = z.object({ controlId: diagramIdSchema, value: z.string().min(1) }).strict();
export type DiagramControlCondition = z.infer<typeof diagramControlConditionSchema>;

/** Disjunctive normal form: the connection holds when at least one AND clause holds. */
export const diagramControlPathsSchema = z.array(z.array(diagramControlConditionSchema)).min(1);
export type DiagramControlPaths = z.infer<typeof diagramControlPathsSchema>;

const diagramControlBaseShape = {
  id: diagramIdSchema,
  owner: diagramIdSchema,
  label: z.string().min(1),
  dependsOn: diagramControlPathsSchema,
};
export const diagramControlSchema = z.discriminatedUnion("kind", [
  z.object({ ...diagramControlBaseShape, kind: z.literal("conditional") }).strict(),
  z
    .object({
      ...diagramControlBaseShape,
      kind: z.literal("branch"),
      cases: z.array(z.object({ id: diagramIdSchema, label: z.string().min(1) }).strict()).min(2),
    })
    .strict(),
]);
export type DiagramControl = z.infer<typeof diagramControlSchema>;

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

/** A decision point for one branch control. The node's id is the control's id. */
export const decisionDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    type: z.literal("decision"),
  })
  .strict();
export type DecisionDiagramNode = z.infer<typeof decisionDiagramNodeSchema>;

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
  decisionDiagramNodeSchema,
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
    activeWhen: diagramControlPathsSchema.optional(),
    /** The decision-node port (branch case id) this edge leaves from. */
    sourcePort: diagramIdSchema.optional(),
    /** Edge-label guards: the conditions rendered on this edge's label. */
    guards: diagramControlPathsSchema.optional(),
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
    roots: z.array(diagramIdSchema).min(1).readonly().optional(),
    controls: z.array(diagramControlSchema).readonly().optional(),
  })
  .strict()
  .superRefine((graph, context) => {
    const hasComponentStructure = graph.controls != null || graph.roots != null;
    if (hasComponentStructure) {
      graph.nodes.forEach((node, index) => {
        if (node.type !== "default" && node.type !== "decision") {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "type"],
            message: "Component structure supports only default and decision nodes",
          });
        }
      });
      graph.edges.forEach((edge, index) => {
        if (edge.type !== "default") {
          context.addIssue({
            code: "custom",
            path: ["edges", index, "type"],
            message: "Component structure supports only default edges",
          });
        }
      });
      if (graph.controls != null && graph.roots == null) {
        context.addIssue({
          code: "custom",
          path: ["roots"],
          message: "Component controls require declared roots",
        });
      }
    }
    const controls = new Map(graph.controls?.map((control) => [control.id, control]));
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const rootIds = new Set<string>();
    graph.roots?.forEach((root, index) => {
      if (!nodeIds.has(root) || rootIds.has(root)) {
        context.addIssue({
          code: "custom",
          path: ["roots", index],
          message: `${nodeIds.has(root) ? "Duplicate" : "Unknown"} component root: ${root}`,
        });
      }
      rootIds.add(root);
    });
    const controlIds = new Set<string>();
    graph.controls?.forEach((control, index) => {
      if (controlIds.has(control.id)) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "id"],
          message: `Duplicate component control: ${control.id}`,
        });
      }
      controlIds.add(control.id);
      if (!nodeIds.has(control.owner)) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "owner"],
          message: `Unknown component control owner: ${control.owner}`,
        });
      }
      if (control.kind === "branch") {
        const caseIds = new Set<string>();
        control.cases.forEach((branchCase, caseIndex) => {
          if (caseIds.has(branchCase.id)) {
            context.addIssue({
              code: "custom",
              path: ["controls", index, "cases", caseIndex, "id"],
              message: `Duplicate component control case: ${branchCase.id}`,
            });
          }
          caseIds.add(branchCase.id);
        });
      }
    });
    const branchControls = new Map(
      (graph.controls ?? []).filter((control) => control.kind === "branch").map((control) => [control.id, control]),
    );
    const outgoingSources = new Set(graph.edges.map((edge) => edge.source));
    const incomingTargets = new Set(graph.edges.map((edge) => edge.target));
    graph.nodes.forEach((node, index) => {
      if (node.type !== "decision") return;
      const control = branchControls.get(node.id);
      if (!control) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Decision node must reuse its branch control id: ${node.id}`,
        });
        return;
      }
      if (!incomingTargets.has(node.id)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Decision node without incoming edges: ${node.id}`,
        });
      }
      if (!outgoingSources.has(node.id)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Decision node without outgoing edges: ${node.id}`,
        });
      }
    });
    const validatePaths = (paths: DiagramControlPaths, path: (string | number)[]) => {
      paths.forEach((conditions, pathIndex) => {
        const values = new Map<string, string>();
        conditions.forEach((condition, conditionIndex) => {
          const previous = values.get(condition.controlId);
          if (previous !== undefined && previous !== condition.value) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, conditionIndex],
              message: `Contradictory component path: ${condition.controlId}`,
            });
          }
          values.set(condition.controlId, condition.value);
          const control = controls.get(condition.controlId);
          if (!control) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, conditionIndex, "controlId"],
              message: `Unknown component control: ${condition.controlId}`,
            });
          } else if (
            control.kind === "conditional"
              ? condition.value !== "on" && condition.value !== "off"
              : !control.cases.some((branchCase) => branchCase.id === condition.value)
          ) {
            context.addIssue({
              code: "custom",
              path: [...path, pathIndex, conditionIndex, "value"],
              message: `Invalid value for component control ${condition.controlId}: ${condition.value}`,
            });
          }
        });
      });
    };
    graph.edges.forEach((edge, index) => {
      if (edge.type !== "default") return;
      if (edge.activeWhen) validatePaths(edge.activeWhen, ["edges", index, "activeWhen"]);
      if (edge.guards) validatePaths(edge.guards, ["edges", index, "guards"]);
      if (edge.sourcePort) {
        const control = branchControls.get(edge.source);
        if (!control) {
          context.addIssue({
            code: "custom",
            path: ["edges", index, "sourcePort"],
            message: `Source port requires a decision-node source: ${edge.source}`,
          });
        } else if (!control.cases.some((branchCase) => branchCase.id === edge.sourcePort)) {
          context.addIssue({
            code: "custom",
            path: ["edges", index, "sourcePort"],
            message: `Unknown source port for decision ${edge.source}: ${edge.sourcePort}`,
          });
        }
      }
    });
    graph.controls?.forEach((control, index) => {
      validatePaths(control.dependsOn, ["controls", index, "dependsOn"]);
    });
    if (hasComponentStructure) {
      const targetsWithIncoming = new Set(
        graph.edges.filter((edge) => edge.type === "default").map((edge) => edge.target),
      );
      graph.nodes.forEach((node, index) => {
        if (node.type !== "default" || targetsWithIncoming.has(node.id) || rootIds.has(node.id)) return;
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Component node without incoming edges must be a declared root: ${node.id}`,
        });
      });
    }
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const path of controls.get(id)?.dependsOn ?? []) {
        for (const condition of path) if (hasCycle(condition.controlId)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...controls.keys()].some(hasCycle)) {
      context.addIssue({
        code: "custom",
        path: ["controls"],
        message: "Component control prerequisites contain a cycle",
      });
    }
  });
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;

/** True when the graph declares component control structure (roots or controls). */
export function hasComponentStructure(graph: Pick<DiagramGraph, "controls" | "roots">): boolean {
  return graph.controls != null || graph.roots != null;
}
