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

/* === Route requirements === */

/** One route requirement: the control `controlId` must currently hold `value`. */
export const diagramRouteRequirementSchema = z
  .object({ controlId: diagramIdSchema, value: z.string().min(1) })
  .strict();
export type DiagramRouteRequirement = z.infer<typeof diagramRouteRequirementSchema>;

/** Route requirements joined by AND: the rule holds only when every requirement in it holds. */
export const diagramRouteRequirementRuleSchema = z.array(diagramRouteRequirementSchema);
export type DiagramRouteRequirementRule = z.infer<typeof diagramRouteRequirementRuleSchema>;

/** Rules joined by OR, in no particular order: the ruleset holds when any one rule holds. */
export const diagramRouteRequirementRulesetSchema = z.array(diagramRouteRequirementRuleSchema).min(1);
export type DiagramRouteRequirementRuleset = z.infer<typeof diagramRouteRequirementRulesetSchema>;

/* === Control === */

const diagramControlBaseShape = {
  id: diagramIdSchema,
  owner: diagramIdSchema,
  label: z.string().min(1),
  dependsOn: diagramRouteRequirementRulesetSchema,
};
export const diagramControlSchema = z.discriminatedUnion("kind", [
  z.object({ ...diagramControlBaseShape, kind: z.literal("conditional") }).strict(),
  z
    .object({
      ...diagramControlBaseShape,
      kind: z.literal("branch"),
      cases: z.array(z.object({ id: diagramIdSchema, label: z.string().min(1) }).strict()).min(2),
      /** Present when the cases are one boolean subject and its negation (a boolean gate): consumers read the switch shape from this flag instead of parsing labels (ADR 0005). */
      polarityPair: z.literal(true).optional(),
    })
    .strict(),
]);
export type DiagramControl = z.infer<typeof diagramControlSchema>;

/* === Node === */

/** Component provenance: the supplier and slot that composed a merged component instance. */
const diagramComponentMetadataSchema = z
  .object({
    definitionId: diagramIdSchema,
    origins: z.array(
      z.object({ supplierId: diagramIdSchema, supplierTitle: z.string().min(1), prop: z.string().min(1) }).strict(),
    ),
  })
  .strict();

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
  })
  .strict();
export type DefaultDiagramEdge = z.infer<typeof defaultDiagramEdgeSchema>;

/** A composition gated by controls: the relationship applies when its `activeWhen` ruleset holds. */
export const controlDiagramEdgeSchema = z
  .object({
    id: diagramIdSchema,
    type: z.literal("control"),
    source: diagramIdSchema,
    target: diagramIdSchema,
    activeWhen: diagramRouteRequirementRulesetSchema,
  })
  .strict();
export type ControlDiagramEdge = z.infer<typeof controlDiagramEdgeSchema>;

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

export const diagramEdgeSchema = z.discriminatedUnion("type", [
  defaultDiagramEdgeSchema,
  controlDiagramEdgeSchema,
  messageDiagramEdgeSchema,
]);
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

/** The optional display fields an authored edge carries; `control` edges state their condition in `activeWhen` instead. */
export function diagramEdgeDisplay(edge: DiagramEdge): Readonly<{ label?: string; kind?: string; href?: string }> {
  return edge.type === "control" ? {} : edge;
}

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

type GraphIssue = Readonly<{ code: "custom"; path?: (string | number)[]; message: string }>;

/**
 * Integrity every graph shares regardless of layout: element ids are unique,
 * group hierarchies reference existing parents without cycling, nodes belong
 * to known groups, and edges connect existing nodes.
 */
function validateGraphIntegrity(graph: DiagramGraphLike): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const graphElements = [
    ...graph.groups.map((element, index) => ({ element, path: ["groups", index, "id"] as const })),
    ...graph.nodes.map((element, index) => ({ element, path: ["nodes", index, "id"] as const })),
    ...graph.edges.map((element, index) => ({ element, path: ["edges", index, "id"] as const })),
  ];
  graphElements.forEach(({ element, path }, index) => {
    if (graphElements.findIndex(({ element: candidate }) => candidate.id === element.id) !== index) {
      issues.push({ code: "custom", path: [...path], message: `Duplicate diagram element ID: ${element.id}` });
    }
  });

  const groupIds = new Set(graph.groups.map(({ id }) => id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groupById = Object.fromEntries(graph.groups.map((group) => [group.id, group]));

  graph.groups.forEach((group, index) => {
    if (group.parentId && !groupIds.has(group.parentId)) {
      issues.push({
        code: "custom",
        path: ["groups", index, "parentId"],
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

  if (graph.groups.some(({ id }) => containsGroupCycle(id, [id]))) {
    issues.push({ code: "custom", path: ["groups"], message: "Diagram group hierarchy contains a cycle" });
  }

  graph.nodes.forEach((node, index) => {
    if (node.groupId && !groupIds.has(node.groupId)) {
      issues.push({
        code: "custom",
        path: ["nodes", index, "groupId"],
        message: `Diagram node ${node.id} belongs to unknown group ${node.groupId}`,
      });
    }
  });

  graph.edges.forEach((edge, index) => {
    if (!nodeById.has(edge.source)) {
      issues.push({
        code: "custom",
        path: ["edges", index, "source"],
        message: `Diagram edge ${edge.id} sources unknown node ${edge.source}`,
      });
    }
    if (!nodeById.has(edge.target)) {
      issues.push({
        code: "custom",
        path: ["edges", index, "target"],
        message: `Diagram edge ${edge.id} targets unknown node ${edge.target}`,
      });
    }
  });
  return issues;
}

type DiagramGraphLike = Readonly<{
  groups: readonly DiagramGroup[];
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
}>;

const graphBaseShape = {
  groups: z.array(diagramGroupSchema).readonly(),
  nodes: z.array(diagramNodeSchema).min(1).readonly(),
  edges: z.array(diagramEdgeSchema).readonly(),
};

/** The general graph contract: any node and edge kinds the diagram schemas define. */
export const diagramGraphSchema = z
  .object(graphBaseShape)
  .strict()
  .superRefine((graph, context) => {
    for (const issue of validateGraphIntegrity(graph)) context.addIssue(issue);
  });
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;

/* === Layout-specific graphs === */

/** Sequence integrity: activations and fragment branches reference messages in span order. */
function validateSequenceGraph(graph: SequenceDiagramGraph): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const messageEdges = graph.edges.filter((edge): edge is MessageDiagramEdge => edge.type === "message");
  const messageById = new Map(messageEdges.map((edge) => [edge.id, edge]));
  const messageIndexes = new Map(messageEdges.map((edge, index) => [edge.id, index]));

  graph.nodes.forEach((node, index) => {
    if (node.type === "lifeline") {
      const activationIds = new Set<string>();
      node.activations.forEach((activation, activationIndex) => {
        if (activationIds.has(activation.id)) {
          issues.push({
            code: "custom",
            path: ["nodes", index, "activations", activationIndex, "id"],
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
            issues.push({
              code: "custom",
              path: ["nodes", index, "activations", activationIndex, boundaryName, "messageId"],
              message: `Activation ${activation.id} references unknown message ${boundary.messageId}`,
            });
            continue;
          }

          const endpointNodeId = boundary.endpoint === "source" ? message.source : message.target;
          if (endpointNodeId !== node.id) {
            issues.push({
              code: "custom",
              path: ["nodes", index, "activations", activationIndex, boundaryName],
              message: `Activation ${activation.id} ${boundaryName} does not belong to lifeline ${node.id}`,
            });
          }
        }

        const startIndex = messageIndexes.get(activation.startsAt.messageId);
        const endIndex = messageIndexes.get(activation.endsAt.messageId);
        if (startIndex !== undefined && endIndex !== undefined && startIndex > endIndex) {
          issues.push({
            code: "custom",
            path: ["nodes", index, "activations", activationIndex],
            message: `Activation ${activation.id} ends before it starts`,
          });
        }
      });
    }

    if (node.type === "fragment") {
      const branchIds = new Set<string>();
      node.branches.forEach((branch, branchIndex) => {
        if (branchIds.has(branch.id)) {
          issues.push({
            code: "custom",
            path: ["nodes", index, "branches", branchIndex, "id"],
            message: `Duplicate fragment branch ID: ${branch.id}`,
          });
        }
        branchIds.add(branch.id);

        const startIndex = messageIndexes.get(branch.startMessageId);
        const endIndex = messageIndexes.get(branch.endMessageId);
        if (startIndex === undefined || endIndex === undefined) {
          if (startIndex === undefined) {
            issues.push({
              code: "custom",
              path: ["nodes", index, "branches", branchIndex, "startMessageId"],
              message: `Fragment branch ${branch.id} references unknown message ${branch.startMessageId}`,
            });
          }
          if (endIndex === undefined) {
            issues.push({
              code: "custom",
              path: ["nodes", index, "branches", branchIndex, "endMessageId"],
              message: `Fragment branch ${branch.id} references unknown message ${branch.endMessageId}`,
            });
          }
        } else if (startIndex > endIndex) {
          issues.push({
            code: "custom",
            path: ["nodes", index, "branches", branchIndex],
            message: `Fragment branch ${branch.id} ends before it starts`,
          });
        }
      });
    }
  });

  graph.edges.forEach((edge, index) => {
    if (edge.type !== "message") return;
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (source?.type !== "lifeline") {
      issues.push({
        code: "custom",
        path: ["edges", index, "source"],
        message: `Message edge ${edge.id} source must be a lifeline`,
      });
    }
    if (target?.type !== "lifeline") {
      issues.push({
        code: "custom",
        path: ["edges", index, "target"],
        message: `Message edge ${edge.id} target must be a lifeline`,
      });
    }
  });
  return issues;
}

export const sequenceDiagramGraphSchema = z
  .object({
    ...graphBaseShape,
    nodes: z
      .array(z.discriminatedUnion("type", [lifelineDiagramNodeSchema, fragmentDiagramNodeSchema]))
      .min(1)
      .readonly(),
    edges: z.array(messageDiagramEdgeSchema).readonly(),
  })
  .strict()
  .superRefine((graph, context) => {
    const issues = [
      ...validateGraphIntegrity(graph),
      ...validateSequenceGraph(graph),
      ...(graph.groups.length > 0
        ? [{ code: "custom" as const, path: ["groups"], message: "Sequence layout does not support diagram groups" }]
        : []),
      ...(!graph.nodes.some((node) => node.type === "lifeline")
        ? [{ code: "custom" as const, path: ["nodes"], message: "Sequence layout requires at least one lifeline" }]
        : []),
    ];
    for (const issue of issues) context.addIssue(issue);
  });
export type SequenceDiagramGraph = z.infer<typeof sequenceDiagramGraphSchema>;

export const dependencyDiagramGraphSchema = z
  .object({
    ...graphBaseShape,
    nodes: z.array(defaultDiagramNodeSchema).min(1).readonly(),
    edges: z.array(defaultDiagramEdgeSchema).readonly(),
  })
  .strict()
  .superRefine((graph, context) => {
    for (const issue of validateGraphIntegrity(graph)) context.addIssue(issue);
  });
export type DependencyDiagramGraph = z.infer<typeof dependencyDiagramGraphSchema>;

export const componentStructureDiagramNodeSchema = defaultDiagramNodeSchema.extend({
  component: diagramComponentMetadataSchema.optional(),
});

/** Additional graph properties a component structure diagram stores: its roots and controls. */
export const componentStructureAdditionalSchema = z
  .object({
    roots: z.array(diagramIdSchema).min(1).readonly(),
    controls: z.array(diagramControlSchema).readonly(),
  })
  .strict();
export type ComponentStructureAdditional = z.infer<typeof componentStructureAdditionalSchema>;

/** Component structure integrity: declared roots and controls agree with the stored relationships. */
function validateComponentStructureGraph(graph: ComponentStructureDiagramGraph): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const { roots, controls } = graph.additional;
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  const rootIds = new Set<string>();
  roots.forEach((root, index) => {
    if (!nodeIds.has(root) || rootIds.has(root)) {
      issues.push({
        code: "custom",
        path: ["additional", "roots", index],
        message: `${nodeIds.has(root) ? "Duplicate" : "Unknown"} component root: ${root}`,
      });
    }
    rootIds.add(root);
  });

  const controlIds = new Set<string>();
  controls.forEach((control, index) => {
    if (controlIds.has(control.id)) {
      issues.push({
        code: "custom",
        path: ["additional", "controls", index, "id"],
        message: `Duplicate component control: ${control.id}`,
      });
    }
    controlIds.add(control.id);
    if (!nodeIds.has(control.owner)) {
      issues.push({
        code: "custom",
        path: ["additional", "controls", index, "owner"],
        message: `Unknown component control owner: ${control.owner}`,
      });
    }
    if (control.kind === "branch") {
      const caseIds = new Set<string>();
      control.cases.forEach((branchCase, caseIndex) => {
        if (caseIds.has(branchCase.id)) {
          issues.push({
            code: "custom",
            path: ["additional", "controls", index, "cases", caseIndex, "id"],
            message: `Duplicate component control case: ${branchCase.id}`,
          });
        }
        caseIds.add(branchCase.id);
      });
    }
  });

  const validateRuleset = (ruleset: DiagramRouteRequirementRuleset, issuePath: (string | number)[]) => {
    ruleset.forEach((rule, ruleIndex) => {
      const values = new Map<string, string>();
      rule.forEach((requirement, requirementIndex) => {
        const previous = values.get(requirement.controlId);
        if (previous !== undefined && previous !== requirement.value) {
          issues.push({
            code: "custom",
            path: [...issuePath, ruleIndex, requirementIndex],
            message: `Contradictory rule for control: ${requirement.controlId}`,
          });
        }
        values.set(requirement.controlId, requirement.value);
        const control = controlsById.get(requirement.controlId);
        if (!control) {
          issues.push({
            code: "custom",
            path: [...issuePath, ruleIndex, requirementIndex, "controlId"],
            message: `Unknown component control: ${requirement.controlId}`,
          });
        } else if (
          control.kind === "conditional"
            ? requirement.value !== "on" && requirement.value !== "off"
            : !control.cases.some((branchCase) => branchCase.id === requirement.value)
        ) {
          issues.push({
            code: "custom",
            path: [...issuePath, ruleIndex, requirementIndex, "value"],
            message: `Invalid value for component control ${requirement.controlId}: ${requirement.value}`,
          });
        }
      });
    });
  };

  graph.edges.forEach((edge, index) => {
    if (edge.type === "control") validateRuleset(edge.activeWhen, ["edges", index, "activeWhen"]);
  });
  controls.forEach((control, index) => {
    validateRuleset(control.dependsOn, ["additional", "controls", index, "dependsOn"]);
  });

  const targetsWithIncoming = new Set(graph.edges.map((edge) => edge.target));
  graph.nodes.forEach((node, index) => {
    if (!targetsWithIncoming.has(node.id) && !rootIds.has(node.id)) {
      issues.push({
        code: "custom",
        path: ["nodes", index, "id"],
        message: `Component node without incoming edges must be a declared root: ${node.id}`,
      });
    }
  });

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const path of controlsById.get(id)?.dependsOn ?? []) {
      for (const condition of path) if (hasCycle(condition.controlId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if ([...controlsById.keys()].some(hasCycle)) {
    issues.push({
      code: "custom",
      path: ["additional", "controls"],
      message: "Component control prerequisites contain a cycle",
    });
  }
  return issues;
}

export const componentStructureDiagramGraphSchema = z
  .object({
    ...graphBaseShape,
    nodes: z.array(componentStructureDiagramNodeSchema).min(1).readonly(),
    edges: z.array(z.discriminatedUnion("type", [defaultDiagramEdgeSchema, controlDiagramEdgeSchema])).readonly(),
    additional: componentStructureAdditionalSchema,
  })
  .strict()
  .superRefine((graph, context) => {
    for (const issue of validateComponentStructureGraph(graph)) context.addIssue(issue);
  });
export type ComponentStructureDiagramGraph = z.infer<typeof componentStructureDiagramGraphSchema>;
