import { createHash } from "node:crypto";

import type {
  DecisionDiagramNode,
  DefaultDiagramEdge,
  DefaultDiagramNode,
  DiagramControl,
  DiagramGraph,
  DiagramRouteRequirement,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";
import { combineRulesets, unionRulesets } from "@/features/diagram/diagram-route-requirement-rules";

// Each dead case gets its own Non-component node: a case that renders nothing
// is its own piece of markup at its own branch site, not a shared definition
// the way identical component internals are.
function nonComponentNodeId(controlId: string, caseId: string): string {
  return `${controlId}:${caseId}:non-component`;
}

type Segment = Readonly<{
  source: string;
  target: string;
  sourcePort?: string;
  guards: DiagramRouteRequirementRuleset;
  activeWhen: DiagramRouteRequirementRuleset;
}>;

function segmentId(segment: Omit<Segment, "guards" | "activeWhen">): string {
  return `edge:${createHash("sha256")
    .update([segment.source, segment.target, segment.sourcePort ?? ""].join("\0"))
    .digest("hex")
    .slice(0, 16)}`;
}

const requirementKey = (requirement: DiagramRouteRequirement): string =>
  `${requirement.controlId}\0${requirement.value}`;

/**
 * Authored graphs may keep an edge's `activeWhen` local and declare the rest of
 * a control's prerequisites through `dependsOn`. Rendering needs every guard
 * visible, so the projection lifts those prerequisites onto the segment that
 * reaches the control: a decision's entry segment names what must hold before
 * the branch applies, and untraversed conditional prerequisites ride the same
 * edge as the control they gate. Disjunctive prerequisites stay disjunctive —
 * the alternatives spread across guard rules instead of contradicting.
 */
function missingGuardRules(
  seeds: readonly DiagramRouteRequirement[],
  rule: readonly DiagramRouteRequirement[],
  controlsById: ReadonlyMap<string, Pick<DiagramControl, "dependsOn">>,
): DiagramRouteRequirementRuleset {
  const claimed = new Set(rule.map(requirementKey));
  const expanded = new Set<string>();
  let results: DiagramRouteRequirementRuleset = [[]];
  const queue = [...seeds];
  while (queue.length > 0) {
    const seed = queue.shift()!;
    if (expanded.has(seed.controlId)) continue;
    expanded.add(seed.controlId);
    const additions = (controlsById.get(seed.controlId)?.dependsOn ?? [[]]).map((dependencyRule) =>
      dependencyRule.filter((dependency) => !claimed.has(requirementKey(dependency))),
    );
    for (const addition of additions) {
      for (const dependency of addition) {
        claimed.add(requirementKey(dependency));
        queue.push(dependency);
      }
    }
    results = combineRulesets(results, additions);
  }
  return results;
}

/**
 * Splits one rule that crosses a branch chain into hop segments. Each branch
 * condition ends a segment at that control's decision node; the segment's
 * `sourcePort` is the previous branch's chosen case, its `guards` carry the
 * conditions the edge label renders (the branch choice plus any surrounding
 * conditional guards), and its `activeWhen` accumulates every condition up to
 * but excluding the branch that ends it.
 */
function segmentsOf(
  rule: readonly DiagramRouteRequirement[],
  edge: DefaultDiagramEdge,
  isBranch: (controlId: string) => boolean,
  controlsById: ReadonlyMap<string, Pick<DiagramControl, "dependsOn">>,
): Segment[] {
  const segments: (Segment & { seeds: DiagramRouteRequirement[] })[] = [];
  let start = edge.source;
  let startPort: string | undefined;
  let portCondition: DiagramRouteRequirement | undefined;
  const activeWhen: DiagramRouteRequirement[] = [];
  let span: DiagramRouteRequirement[] = [];

  const push = (target: string, reached?: DiagramRouteRequirement): void => {
    // Snapshot the accumulators: later rules keep mutating them. The label
    // keeps the port choice; prerequisite lifting seeds only from the span —
    // the port branch's own prerequisites belong to the segment entering it.
    segments.push({
      source: start,
      target,
      ...(startPort ? { sourcePort: startPort } : {}),
      guards: [[...(portCondition ? [portCondition] : []), ...span]],
      seeds: [...span, ...(reached ? [reached] : [])],
      activeWhen: [[...activeWhen]],
    });
  };

  for (const requirement of rule) {
    if (!isBranch(requirement.controlId)) {
      activeWhen.push(requirement);
      span.push(requirement);
      continue;
    }
    push(requirement.controlId, requirement);
    start = requirement.controlId;
    startPort = requirement.value;
    portCondition = requirement;
    activeWhen.push(requirement);
    span = [];
  }
  push(edge.target);

  // Lift declared-but-untraversed prerequisites onto the segments that reach
  // their controls, so every guard renders somewhere.
  return segments.map(({ seeds, ...segment }) => {
    const missing = missingGuardRules(seeds, rule, controlsById);
    return { ...segment, guards: combineRulesets(segment.guards, missing) };
  });
}

/**
 * Projects branch controls as decision nodes. Every branch control gains a
 * decision node whose id is the control's id; edges are re-cut into hops
 * through the chain of decision nodes their rules traverse, with the leaving
 * case as the source port. Branch cases no edge requires route to their own
 * "Non-component" node instead of disappearing: rendering nothing is still a
 * rendering path, so the option stays selectable. Conditional controls gain no
 * node — their guards ride the edge labels of the hop they constrain.
 */
export function projectDecisionNodes(graph: DiagramGraph): DiagramGraph {
  const controls = graph.controls ?? [];
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const branchControls = controls.filter((control) => control.kind === "branch");
  const branchControlIds = new Set(branchControls.map(({ id }) => id));

  const alivePairs = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== "default") continue;
    for (const rule of edge.activeWhen ?? [])
      for (const { controlId, value } of rule) alivePairs.add(`${controlId}\0${value}`);
  }

  const edgesById = new Map<string, DefaultDiagramEdge>();
  const segments = new Map<string, Segment & { kind?: string; label?: string; href?: string }>();
  for (const edge of graph.edges) {
    if (edge.type !== "default") continue;
    const ruleset = edge.activeWhen ?? [[]];
    const branchless = ruleset.filter((rule) => !rule.some(({ controlId }) => branchControlIds.has(controlId)));
    const branched = ruleset.filter((rule) => rule.some(({ controlId }) => branchControlIds.has(controlId)));

    if (branchless.length > 0) {
      // The edge stays whole: no branch ever cuts it, so its guards are the
      // plain conjunctions of its own rules plus their untraversed prerequisites.
      edgesById.set(edge.id, {
        ...edge,
        activeWhen: branchless.length === ruleset.length ? edge.activeWhen : branchless,
        guards: branchless.flatMap((rule) => combineRulesets([rule], missingGuardRules(rule, rule, controlsById))),
      });
    }
    for (const rule of branched) {
      for (const segment of segmentsOf(rule, edge, branchControlIds.has.bind(branchControlIds), controlsById)) {
        const key = [segment.source, segment.target, segment.sourcePort ?? ""].join("\0");
        const existing = segments.get(key);
        const terminal = segment.target === edge.target;
        if (!existing) {
          segments.set(key, {
            ...segment,
            guards: unionRulesets(segment.guards),
            activeWhen: unionRulesets(segment.activeWhen),
            ...(terminal ? { kind: edge.kind, label: edge.label, href: edge.href } : {}),
          });
          continue;
        }
        segments.set(key, {
          ...existing,
          guards: unionRulesets(existing.guards, segment.guards),
          activeWhen: unionRulesets(existing.activeWhen, segment.activeWhen),
        });
      }
    }
  }

  // Dead arms: a case no edge in the graph requires renders no component, so
  // it routes to its own Non-component node and stays selectable. The nodes are
  // per case, never merged: each is an individual piece of markup at its own
  // branch site, not a reused definition.
  const deadArms: (Segment & { kind?: string; label?: string; href?: string })[] = [];
  const nonComponentNodes: DefaultDiagramNode[] = [];
  for (const control of branchControls) {
    for (const branchCase of control.cases) {
      if (alivePairs.has(`${control.id}\0${branchCase.id}`)) continue;
      deadArms.push({
        source: control.id,
        target: nonComponentNodeId(control.id, branchCase.id),
        sourcePort: branchCase.id,
        guards: [[{ controlId: control.id, value: branchCase.id }]],
        activeWhen: control.dependsOn.map((rule) => [...rule, { controlId: control.id, value: branchCase.id }]),
      });
      nonComponentNodes.push({
        type: "default",
        id: nonComponentNodeId(control.id, branchCase.id),
        title: "Non-component",
      });
    }
  }

  const decisionNodes: DecisionDiagramNode[] = branchControls.map((control) => ({
    type: "decision",
    id: control.id,
    title: control.label,
  }));

  const projectedEdges = [...segments.values(), ...deadArms].map((segment) => ({
    type: "default" as const,
    id: segmentId(segment),
    source: segment.source,
    target: segment.target,
    ...(segment.sourcePort ? { sourcePort: segment.sourcePort } : {}),
    ...(segment.kind ? { kind: segment.kind } : {}),
    ...(segment.label ? { label: segment.label } : {}),
    ...(segment.href ? { href: segment.href } : {}),
    ...(segment.activeWhen.length > 1 || Object.keys(segment.activeWhen.at(0) ?? {}).length > 0
      ? { activeWhen: segment.activeWhen }
      : {}),
    guards: segment.guards,
  }));

  const nodes = [...graph.nodes, ...decisionNodes, ...nonComponentNodes];
  return {
    ...graph,
    nodes: nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgesById.values(), ...projectedEdges].toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}
