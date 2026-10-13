import { MarkerType, Position } from "@xyflow/react";
import { Check, Split } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { type DiagramRendererProps, DiagramView } from "@/client/parts/diagram-view";
import {
  buildDiagramReactFlowGroups,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
  toRectangleNodeData,
} from "@/client/parts/diagram-view.react-flow";
import type { Artifact } from "@/features/artifact/artifact";
import { isComponentStructureArtifact } from "@/features/artifact/artifact";
import { getPolarityPairCases } from "@/features/diagram/control-polarity";
import type {
  ComponentStructureDiagramGraph,
  DiagramControl,
  DiagramRouteRequirement,
  DiagramRouteRequirementRule,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";
import { combineRulesets, unionRulesets } from "@/features/diagram/diagram-route-requirement-rules";
import type { DiagramLayout, DiagramLayoutEdge, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { BaseEdgeLabel } from "@/shared/react-flow/base-edge-label";
import { ReferencePanel } from "@/shared/react-flow/diagram-overlays";
import type { DiamondReactFlowNode } from "@/shared/react-flow/diamond-node";
import {
  clearEdgeHighlight,
  type EdgeHighlightOrigin,
  reportEdgeHighlight,
  subscribeEdgeHighlight,
} from "@/shared/react-flow/edge-highlight";
import { toBezierPath, toPolylinePath, toSplinePath } from "@/shared/react-flow/edge-paths";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import {
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/shared/react-ui/select";
import { Switch } from "@/shared/react-ui/switch";

import {
  layoutComponentGuardLabels,
  layoutComponentStructureDiagram,
  type ProjectedComponentStructureEdge,
  type ProjectedComponentStructureGraph,
  projectedComponentStructureNodeId,
  type ProjectedDecisionNode,
  type ProjectedNonComponentNode,
} from "./component-structure-diagram-renderer.layout";

// Each dead case gets its own non-component node: a case that renders nothing
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

// Segment ids land in DOM ids and React keys inside the browser bundle, so the
// projection hashes with two decorrelated FNV-1a lanes instead of node:crypto:
// 64 bits of stable, dependency-free hex, unique within one projected graph.
function fnv1a32(value: string, basis: number): number {
  let hash = basis;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function segmentHash(value: string): string {
  return `${fnv1a32(value, 0x811c9dc5).toString(16).padStart(8, "0")}${fnv1a32(value, 0x9747b28c)
    .toString(16)
    .padStart(8, "0")}`;
}

function segmentId(segment: Omit<Segment, "guards" | "activeWhen">): string {
  return `edge:${segmentHash([segment.source, segment.target, segment.sourcePort ?? ""].join("\0"))}`;
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
  edge: Readonly<{ sourceNodeId: string; targetNodeId: string }>,
  isBranch: (controlId: string) => boolean,
  controlsById: ReadonlyMap<string, Pick<DiagramControl, "dependsOn">>,
): Segment[] {
  const segments: (Segment & { seeds: DiagramRouteRequirement[] })[] = [];
  let start = edge.sourceNodeId;
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
  push(edge.targetNodeId);

  // Lift declared-but-untraversed prerequisites onto the segments that reach
  // their controls, so every guard renders somewhere.
  return segments.map(({ seeds, ...segment }) => {
    const missing = missingGuardRules(seeds, rule, controlsById);
    return { ...segment, guards: combineRulesets(segment.guards, missing) };
  });
}

/** The stored edges as activation rulesets: `default` applies unconditionally, `control` when its ruleset holds. */
function edgeRuleset(edge: ComponentStructureDiagramGraph["edges"][number]): DiagramRouteRequirementRuleset {
  return edge.type === "control" ? edge.activeWhen : [[]];
}

/**
 * Projects branch controls as decision nodes. Every branch control gains a
 * decision node whose id is the control's id; control edges are re-cut into
 * hops through the chain of decision nodes their rules traverse, with the
 * leaving case as the source port. Branch cases no relationship requires
 * route to their own non-component node instead of disappearing: rendering
 * nothing is still a rendering path, so the option stays selectable.
 * Conditional controls gain no node — their guards ride the edge labels of
 * the hop they constrain.
 */
export function projectDecisionNodes(graph: ComponentStructureDiagramGraph): ProjectedComponentStructureGraph {
  const controls = graph.layoutContext.controls;
  const controlsById = new Map(controls.map((control) => [control.controlId, control]));
  const branchControls = controls.filter((control) => control.type === "branch");
  const branchControlIds = new Set(branchControls.map(({ controlId }) => controlId));

  const alivePairs = new Set<string>();
  for (const edge of graph.edges) {
    for (const rule of edgeRuleset(edge))
      for (const { controlId, value } of rule) alivePairs.add(`${controlId}\0${value}`);
  }

  const wholeEdges = new Map<string, ProjectedComponentStructureEdge>();
  const segments = new Map<string, Segment>();
  for (const edge of graph.edges) {
    const ruleset = edgeRuleset(edge);
    const branchless = ruleset.filter((rule) => !rule.some(({ controlId }) => branchControlIds.has(controlId)));
    const branched = ruleset.filter((rule) => rule.some(({ controlId }) => branchControlIds.has(controlId)));

    if (branchless.length > 0) {
      // The edge stays whole: no branch ever cuts it, so its guards are the
      // plain conjunctions of its own rules plus their untraversed prerequisites.
      // An edge whose rules all avoid branches keeps its stored ruleset;
      // otherwise only its branchless rules stay.
      wholeEdges.set(edge.edgeId, {
        id: edge.edgeId,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        ...(edge.type === "control"
          ? { activeWhen: branchless.length === ruleset.length ? edge.activeWhen : branchless }
          : {}),
        guards: branchless.flatMap((rule) => combineRulesets([rule], missingGuardRules(rule, rule, controlsById))),
      });
    }
    for (const rule of branched) {
      for (const segment of segmentsOf(rule, edge, branchControlIds.has.bind(branchControlIds), controlsById)) {
        const key = [segment.source, segment.target, segment.sourcePort ?? ""].join("\0");
        const existing = segments.get(key);
        if (!existing) {
          segments.set(key, {
            ...segment,
            guards: unionRulesets(segment.guards),
            activeWhen: unionRulesets(segment.activeWhen),
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

  // Dead cases: a case no relationship in the graph requires renders no
  // component, so it routes to its own non-component node and stays
  // selectable. The nodes are per case, never merged.
  const deadCases: Segment[] = [];
  const nonComponentNodes: ProjectedNonComponentNode[] = [];
  for (const control of branchControls) {
    for (const branchCase of control.cases) {
      if (alivePairs.has(`${control.controlId}\0${branchCase.caseId}`)) continue;
      deadCases.push({
        source: control.controlId,
        target: nonComponentNodeId(control.controlId, branchCase.caseId),
        sourcePort: branchCase.caseId,
        guards: [[{ controlId: control.controlId, value: branchCase.caseId }]],
        activeWhen: control.dependsOn.map((rule) => [
          ...rule,
          { controlId: control.controlId, value: branchCase.caseId },
        ]),
      });
      nonComponentNodes.push({
        type: "non-component",
        id: nonComponentNodeId(control.controlId, branchCase.caseId),
        title: "Non-component",
        control,
        caseId: branchCase.caseId,
      });
    }
  }

  const decisionNodes: ProjectedDecisionNode[] = branchControls.map((control) => ({
    type: "decision",
    id: control.controlId,
    title: control.label,
    control,
  }));

  const projectedEdges = [...wholeEdges.values(), ...segments.values(), ...deadCases].map((segment) => ({
    id: segmentId(segment),
    source: segment.source,
    target: segment.target,
    ...(segment.sourcePort ? { sourcePort: segment.sourcePort } : {}),
    ...(segment.activeWhen != null && (segment.activeWhen.length > 1 || (segment.activeWhen.at(0)?.length ?? 0) > 0)
      ? { activeWhen: segment.activeWhen }
      : {}),
    guards: segment.guards,
  }));

  const nodes = [...graph.nodes, ...decisionNodes, ...nonComponentNodes];
  return {
    groups: graph.groups,
    nodes: nodes.toSorted((left, right) =>
      projectedComponentStructureNodeId(left).localeCompare(projectedComponentStructureNodeId(right)),
    ),
    edges: [...projectedEdges].toSorted((left, right) => left.id.localeCompare(right.id)),
    roots: graph.layoutContext.rootNodeIds,
    controls,
    auxiliaryDefinitions: graph.layoutContext.auxiliaryDefinitions,
  };
}

export type ComponentSelection = Readonly<Record<string, string>>;

// Depth counts SCCs, so recursion cannot make an alternative infinitely deep.
function condensedComponents(graph: ProjectedComponentStructureGraph): ReadonlyMap<string, number> {
  const indices = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components = new Map<string, number>();
  let index = 0;
  let component = 0;
  const outgoing = new Map(
    graph.nodes.map((node) => [
      projectedComponentStructureNodeId(node),
      graph.edges.filter((edge) => edge.source === projectedComponentStructureNodeId(node)),
    ]),
  );
  function visit(nodeId: string) {
    indices.set(nodeId, index);
    lowest.set(nodeId, index++);
    stack.push(nodeId);
    onStack.add(nodeId);
    for (const edge of outgoing.get(nodeId)!) {
      if (!indices.has(edge.target)) {
        visit(edge.target);
        lowest.set(nodeId, Math.min(lowest.get(nodeId)!, lowest.get(edge.target)!));
      } else if (onStack.has(edge.target)) {
        lowest.set(nodeId, Math.min(lowest.get(nodeId)!, indices.get(edge.target)!));
      }
    }
    if (lowest.get(nodeId) !== indices.get(nodeId)) return;
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      components.set(member, component);
    } while (member !== nodeId);
    component++;
  }
  for (const node of graph.nodes) {
    const nodeId = projectedComponentStructureNodeId(node);
    if (!indices.has(nodeId)) visit(nodeId);
  }
  return components;
}

function routeMetrics(
  graph: ProjectedComponentStructureGraph,
  components: ReadonlyMap<string, number>,
  starts: readonly ProjectedComponentStructureEdge[],
  source: string,
) {
  const descendants = new Set<string>();
  const pending = starts.map((edge) => edge.target);
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (nodeId === source || descendants.has(nodeId)) continue;
    descendants.add(nodeId);
    for (const edge of graph.edges) {
      if (edge.source === nodeId) pending.push(edge.target);
    }
  }
  const condensedEdges = new Map<number, Set<number>>();
  for (const edge of graph.edges) {
    if (!descendants.has(edge.source) || !descendants.has(edge.target)) continue;
    const source = components.get(edge.source)!;
    const target = components.get(edge.target)!;
    if (source === target) continue;
    const targets = condensedEdges.get(source) ?? new Set<number>();
    targets.add(target);
    condensedEdges.set(source, targets);
  }
  const depths = new Map<number, number>();
  function depth(componentId: number): number {
    const known = depths.get(componentId);
    if (known !== undefined) return known;
    const result = 1 + Math.max(0, ...[...(condensedEdges.get(componentId) ?? [])].map(depth));
    depths.set(componentId, result);
    return result;
  }
  return {
    descendants: descendants.size,
    depth: Math.max(
      0,
      ...starts.filter((edge) => descendants.has(edge.target)).map((edge) => depth(components.get(edge.target)!)),
    ),
    // Decision arms tie-break by their case id (the option identity), while
    // other edges keep their projected id: arm ids are hashes, but the case
    // they leave from is the stable, authored ordering.
    edgeId:
      starts
        .map((edge) => edge.sourcePort ?? edge.id)
        .sort()
        .at(0) ?? "",
  };
}

function compareMetrics(left: ReturnType<typeof routeMetrics>, right: ReturnType<typeof routeMetrics>): number {
  return (
    right.descendants - left.descendants ||
    right.depth - left.depth ||
    (left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0)
  );
}

function componentRulesetHolds(
  ruleset: DiagramRouteRequirementRuleset,
  selection: ComponentSelection,
  controls: readonly DiagramControl[],
  reachableNodes: ReadonlySet<string>,
): boolean {
  return ruleset.some((rule) =>
    rule.every(({ controlId, value }) => {
      if (selection[controlId] !== value) return false;
      const control = controls.find((item) => item.controlId === controlId)!;
      return (
        reachableNodes.has(control.ownerNodeId) &&
        componentRulesetHolds(control.dependsOn, selection, controls, reachableNodes)
      );
    }),
  );
}

type RouteCandidate = Readonly<{ requirements: ReadonlyMap<string, string>; edges: readonly string[] }>;

function mergeRequirements(candidate: RouteCandidate, rule: DiagramRouteRequirementRule): RouteCandidate | undefined {
  const requirements = new Map(candidate.requirements);
  for (const { controlId, value } of rule) {
    const known = requirements.get(controlId);
    if (known !== undefined && known !== value) return undefined;
    requirements.set(controlId, value);
  }
  return { ...candidate, requirements };
}

function ancestorRoutes(
  graph: ProjectedComponentStructureGraph,
  nodeId: string,
  visited = new Set<string>(),
): RouteCandidate[] {
  if (graph.roots.includes(nodeId)) return [{ requirements: new Map(), edges: [] }];
  if (visited.has(nodeId)) return [];
  const nextVisited = new Set([...visited, nodeId]);
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .flatMap((edge) =>
      ancestorRoutes(graph, edge.source, nextVisited).flatMap((ancestor) =>
        (edge.activeWhen ?? [[]]).flatMap((rule) => {
          const merged = mergeRequirements(ancestor, rule);
          return merged ? [{ ...merged, edges: [...ancestor.edges, edge.id] }] : [];
        }),
      ),
    );
}

function withPrerequisites(
  graph: ProjectedComponentStructureGraph,
  candidate: RouteCandidate,
  expanded = new Set<string>(),
): RouteCandidate[] {
  const pending = [...candidate.requirements.keys()].find((controlId) => !expanded.has(controlId));
  if (pending === undefined) return [candidate];
  const control = graph.controls.find((item) => item.controlId === pending)!;
  const nextExpanded = new Set([...expanded, pending]);
  return control.dependsOn.flatMap((rule) => {
    const merged = mergeRequirements(candidate, rule);
    return merged ? withPrerequisites(graph, merged, nextExpanded) : [];
  });
}

function branchMetrics(graph: ProjectedComponentStructureGraph, control: DiagramControl, value: string) {
  const routesByEdge = new Map(
    graph.edges.map((edge) => [
      edge.id,
      (edge.activeWhen ?? [[]]).flatMap((rule) =>
        withPrerequisites(graph, {
          requirements: new Map(rule.map(({ controlId, value }) => [controlId, value])),
          edges: [],
        }),
      ),
    ]),
  );
  // Other controls remain undecided, but an alternative cannot count its own opposite routes.
  const eligibleEdges = graph.edges.filter((edge) =>
    routesByEdge.get(edge.id)!.some((route) => {
      const required = route.requirements.get(control.controlId);
      return required === undefined || required === value;
    }),
  );
  const reachable = new Set(graph.roots);
  const pending = [...reachable];
  while (pending.length) {
    const source = pending.pop()!;
    for (const edge of eligibleEdges) {
      if (edge.source === source && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        pending.push(edge.target);
      }
    }
  }
  const candidateGraph = { ...graph, edges: eligibleEdges.filter((edge) => reachable.has(edge.source)) };
  const starts = candidateGraph.edges.filter((edge) =>
    routesByEdge.get(edge.id)!.some((route) => route.requirements.get(control.controlId) === value),
  );
  return routeMetrics(candidateGraph, condensedComponents(candidateGraph), starts, control.ownerNodeId);
}

export function initialComponentSelection(graph: ProjectedComponentStructureGraph): ComponentSelection {
  return Object.fromEntries(
    graph.controls.map((control) => {
      if (control.type === "conditional") return [control.controlId, "off"];
      const cases = control.cases.map((alternative) => ({
        ...alternative,
        metrics: branchMetrics(graph, control, alternative.caseId),
      }));
      cases.sort((left, right) => compareMetrics(left.metrics, right.metrics));
      return [control.controlId, cases.at(0)!.caseId];
    }),
  );
}

export function componentPathEmphasis(graph: ProjectedComponentStructureGraph, selection: ComponentSelection) {
  const controls = graph.controls;
  const nodes = new Set(graph.roots);
  const edges = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (!nodes.has(edge.source)) continue;
      if (!componentRulesetHolds(edge.activeWhen ?? [[]], selection, controls, nodes)) continue;
      edges.add(edge.id);
      if (!nodes.has(edge.target)) {
        nodes.add(edge.target);
        changed = true;
      }
    }
  }
  const activeControls = new Set(
    controls
      .filter(
        (control) =>
          nodes.has(control.ownerNodeId) && componentRulesetHolds(control.dependsOn, selection, controls, nodes),
      )
      .map((control) => control.controlId),
  );
  return { nodes, edges, controls: activeControls };
}

function withReachableOwners(
  graph: ProjectedComponentStructureGraph,
  selection: ComponentSelection,
  candidate: RouteCandidate,
  attemptedSources = new Set<string>(),
): RouteCandidate[] {
  const selected = { ...selection, ...Object.fromEntries(candidate.requirements) };
  const reachable = componentPathEmphasis(graph, selected).nodes;
  const missingSources = [
    ...new Set(
      [...candidate.requirements.keys()].map(
        (controlId) => graph.controls.find((control) => control.controlId === controlId)!.ownerNodeId,
      ),
    ),
  ].filter((source) => !reachable.has(source));
  if (!missingSources.length) return [candidate];
  const source = missingSources.find((id) => !attemptedSources.has(id));
  if (source === undefined) return [];
  const nextAttempted = new Set([...attemptedSources, source]);
  return ancestorRoutes(graph, source).flatMap((route) => {
    const merged = mergeRequirements(
      candidate,
      [...route.requirements].map(([controlId, value]) => ({ controlId, value })),
    );
    if (!merged) return [];
    return withPrerequisites(graph, { ...merged, edges: [...candidate.edges, ...route.edges] }).flatMap((expanded) =>
      withReachableOwners(graph, selection, expanded, nextAttempted),
    );
  });
}

// Two exclusive branch switches must not read on at once: when a click kills
// the route that carried another polarity-pair branch's on case — its decision
// node just became unreachable — that switch settles to its off case, because
// no route can hold both values. The clicked control keeps its own value even
// on a dead path (pending intent), values dead before the click stay as they
// are, and plain conditionals never settle: each is an independent control,
// not one case among exclusive sisters.
function settleFallenBranchSwitches(
  graph: ProjectedComponentStructureGraph,
  before: ComponentSelection,
  after: ComponentSelection,
  clickedId: string,
): ComponentSelection {
  const beforeEmphasis = componentPathEmphasis(graph, before);
  const afterEmphasis = componentPathEmphasis(graph, after);
  let next = after;
  for (const control of graph.controls) {
    if (control.controlId === clickedId) continue;
    const pair = getPolarityPairCases(control);
    if (!pair) continue;
    const offCase = pair.offCase.caseId;
    if (next[control.controlId] === offCase) continue;
    if (beforeEmphasis.nodes.has(control.controlId) && !afterEmphasis.nodes.has(control.controlId)) {
      next = { ...next, [control.controlId]: offCase };
    }
  }
  return next;
}

export function selectComponentPath(
  graph: ProjectedComponentStructureGraph,
  selection: ComponentSelection,
  controlId: string,
  value: string,
): ComponentSelection {
  const selected = { ...selection, [controlId]: value };
  const control = graph.controls.find((item) => item.controlId === controlId)!;
  const emphasis = componentPathEmphasis(graph, selected);
  if (control.type === "conditional") {
    if (value === "off" || emphasis.controls.has(control.controlId))
      return settleFallenBranchSwitches(graph, selection, selected, controlId);
  } else {
    // A branch needs rerouting only when its arm is unreachable: the control
    // being active just means its owner renders, while the arm leaves the
    // decision node, whose incoming chain may stay gated by other choices.
    const armActive = graph.edges.some(
      (edge) => edge.source === controlId && edge.sourcePort === value && emphasis.edges.has(edge.id),
    );
    if (armActive) return settleFallenBranchSwitches(graph, selection, selected, controlId);
  }
  // Branch arms reroute to the decision node itself — its incoming chain names
  // the choices that must hold before the arm exists. Conditional controls own
  // no node, so they reroute to their owner.
  const rerouteTarget = control.type === "branch" ? control.controlId : control.ownerNodeId;
  const candidates = ancestorRoutes(graph, rerouteTarget).flatMap((route) => {
    const requested = mergeRequirements(route, [{ controlId, value }]);
    return requested
      ? withPrerequisites(graph, requested).flatMap((candidate) => withReachableOwners(graph, selected, candidate))
      : [];
  });
  const changes = (candidate: RouteCandidate) =>
    [...candidate.requirements].filter(([id, required]) => selected[id] !== required).length;
  const components = condensedComponents(graph);
  candidates.sort((left, right) => {
    const difference = changes(left) - changes(right);
    if (difference) return difference;
    // Compare branches where the routes split, not their merged destination.
    const diverging = left.edges.findIndex((edgeId, index) => right.edges[index] !== edgeId);
    if (diverging < 0 || right.edges[diverging] === undefined) return 0;
    const leftEdge = graph.edges.find((edge) => edge.id === left.edges[diverging])!;
    const rightEdge = graph.edges.find((edge) => edge.id === right.edges[diverging])!;
    const leftMetrics = routeMetrics(graph, components, [leftEdge], leftEdge.source);
    const rightMetrics = routeMetrics(graph, components, [rightEdge], rightEdge.source);
    return compareMetrics(leftMetrics, rightMetrics);
  });
  const chosen = candidates.at(0);
  const routed = chosen ? { ...selected, ...Object.fromEntries(chosen.requirements) } : selected;
  return settleFallenBranchSwitches(graph, selection, routed, controlId);
}

// Turning a satisfied rule off keeps the requirements that other active
// rules also name — their pills stay pressed — so a shared rule ends
// partial rather than off. Only conditional requirements switch off, because a
// branch control always holds one case; a rule with nothing left to spare
// forces off entirely.
function releaseGuardRule(
  graph: ProjectedComponentStructureGraph,
  selection: ComponentSelection,
  rule: DiagramRouteRequirementRule,
  activeEdges: ReadonlySet<string>,
  selfEdgeId: string,
  selfIndex: number,
): ComponentSelection {
  const holds = (requirement: DiagramRouteRequirement) => selection[requirement.controlId] === requirement.value;
  const satisfied = graph.edges.flatMap((edge) => {
    if (!edge.guards || !activeEdges.has(edge.id)) return [];
    return edge.guards
      .map((other, index) => ({ edgeId: edge.id, index, rule: other }))
      .filter((other) => (other.edgeId !== selfEdgeId || other.index !== selfIndex) && other.rule.every(holds));
  });
  const shared = (requirement: DiagramRouteRequirement) =>
    satisfied.some((other) =>
      other.rule.some((item) => item.controlId === requirement.controlId && item.value === requirement.value),
    );
  const switchable = rule.filter(
    (requirement) =>
      graph.controls.find((control) => control.controlId === requirement.controlId)?.type === "conditional",
  );
  const exclusive = switchable.filter((requirement) => !shared(requirement));
  return (exclusive.length > 0 ? exclusive : switchable).reduce(
    (next, { controlId, value }) => ({ ...next, [controlId]: value === "on" ? "off" : "on" }),
    selection,
  );
}

// Clicking a guard pill drives its whole AND rule like a nested checkbox:
// an unmet or partially met rule clicks fully on — the rule naming the
// clicked requirement, applied starting from it — while a rule already
// holding on a rendering edge clicks off as one unit. Values can hold on a
// path that lost reachability; clicking there still asks to render it, so a
// conditional pill first repairs in place and only releases when nothing
// repairs or a branch move would be forced.
export function selectEdgePath(
  graph: ProjectedComponentStructureGraph,
  selection: ComponentSelection,
  edgeId: string,
  controlId: string,
  value: string,
): ComponentSelection {
  const controls = graph.controls;
  const control = controls.find((item) => item.controlId === controlId)!;
  const edge = graph.edges.find((item) => item.id === edgeId);
  const guards = edge?.guards;
  const ruleIndex =
    guards?.findIndex((rule) =>
      rule.some((requirement) => requirement.controlId === controlId && requirement.value === value),
    ) ?? -1;
  const rule = ruleIndex >= 0 ? guards!.at(ruleIndex) : guards?.at(0);
  // The clicked requirement applies first: rerouting starts from what the user
  // asked for, and sibling requirements then land on an already-repaired path.
  const applyRule = (from: ComponentSelection): ComponentSelection => {
    const rest = (rule ?? [{ controlId, value }]).filter(
      (requirement) => requirement.controlId !== controlId || requirement.value !== value,
    );
    return [{ controlId, value }, ...rest].reduce(
      (next, requirement) => selectComponentPath(graph, next, requirement.controlId, requirement.value),
      from,
    );
  };
  const holds = rule != null && rule.every((requirement) => selection[requirement.controlId] === requirement.value);
  const activeEdges = componentPathEmphasis(graph, selection).edges;
  if (holds && activeEdges.has(edgeId)) {
    return releaseGuardRule(graph, selection, rule!, activeEdges, edgeId, ruleIndex);
  }
  if (holds && control.type === "conditional") {
    const repaired = applyRule(selection);
    const movedBranch = controls.some(
      (item) => item.type === "branch" && repaired[item.controlId] !== selection[item.controlId],
    );
    const changed = Object.keys(repaired).some((id) => repaired[id] !== selection[id]);
    if (changed && !movedBranch) return repaired;
    return releaseGuardRule(graph, selection, rule!, activeEdges, edgeId, ruleIndex);
  }
  return applyRule(selection);
}

// The combined condition text one edge needs: each AND rule joins its
// requirements and the ruleset joins the rules with ||, so a label states the
// whole activation condition once instead of scattering pills.
const requirementText = (controls: readonly DiagramControl[], controlId: string, value: string): string => {
  const control = controls.find((item) => item.controlId === controlId);
  if (!control) return value;
  if (control.type === "branch") {
    return control.cases.find((branchCase) => branchCase.caseId === value)?.label ?? value;
  }
  // Negate the entire label without interpreting the generator's expression syntax.
  return value === "off" ? `!(${control.label})` : control.label;
};

const ruleText = (controls: readonly DiagramControl[], rule: DiagramRouteRequirementRule): string =>
  rule.map(({ controlId, value }) => requirementText(controls, controlId, value)).join(" && ");

export function routeConditionText(
  controls: readonly DiagramControl[],
  guards: DiagramRouteRequirementRuleset,
): string {
  const rules = guards.map((rule) => ruleText(controls, rule));
  // A multi-requirement rule keeps its parentheses inside an OR list so the
  // AND grouping stays readable.
  return rules.map((text, index) => (rules.length > 1 && guards[index].length > 1 ? `(${text})` : text)).join(" || ");
}

// An edge label carries the branch icon when any rule names a branch case, so
// splitting controls stay visually distinct from plain conditional gates.
export function routeConditionIncludesBranch(
  controls: readonly DiagramControl[],
  guards: DiagramRouteRequirementRuleset,
): boolean {
  return guards.some((rule) =>
    rule.some(({ controlId }) => controls.find((item) => item.controlId === controlId)?.type === "branch"),
  );
}

const INSTANCE_ID_SUFFIX = /@[0-9a-f]{16}$/;
// Merged cards carry the definition id while edges point at instances.
export const toDefinitionId = (nodeId: string): string => nodeId.replace(INSTANCE_ID_SUFFIX, "");

export type RouteConditionChange = Readonly<{
  controlId: string;
  type: DiagramControl["type"];
  label: string;
  ownerLabel: string;
  before: string;
  after: string;
}>;

const requirementValueLabel = (control: DiagramControl, value: string): string => {
  if (control.type !== "branch") return value;
  return control.cases.find((branchCase) => branchCase.caseId === value)?.label ?? value;
};

// The before/after diff hovering an edge asks for: applying that route's rule
// (the same engine a label click runs) against the current selection, then
// reporting only the controls whose value would move. Each change names the
// component that owns the control.
export function describeRouteSelectionChange(
  graph: ProjectedComponentStructureGraph,
  selection: ComponentSelection,
  edgeId: string,
): readonly RouteConditionChange[] {
  const edge = graph.edges.find((item) => item.id === edgeId);
  const representative = edge?.guards.at(0)?.at(0);
  if (!representative) return [];
  const next = selectEdgePath(graph, selection, edgeId, representative.controlId, representative.value);
  const titleByDefinitionId = new Map(
    graph.nodes.map((node) => {
      const nodeId = projectedComponentStructureNodeId(node);
      return [toDefinitionId(nodeId), node.title ?? nodeId] as const;
    }),
  );
  return graph.controls
    .filter((control) => next[control.controlId] !== selection[control.controlId])
    .map((control) => ({
      controlId: control.controlId,
      type: control.type,
      label: control.label,
      ownerLabel: titleByDefinitionId.get(control.ownerNodeId) ?? control.ownerNodeId,
      before: requirementValueLabel(control, selection[control.controlId] ?? ""),
      after: requirementValueLabel(control, next[control.controlId] ?? ""),
    }));
}

// "from X (slot)" bullets live in the card details, derived from the stored
// layout context origins; authored graphs without structured origins fall back
// to the incoming edge labels.
export function collectComponentOrigins(
  graph: Readonly<{
    nodes: ProjectedComponentStructureGraph["nodes"];
    edges: readonly Readonly<{ target: string; source: string; label?: string }>[];
    auxiliaryDefinitions?: readonly { definitionId: string; title: string }[];
  }>,
): ReadonlyMap<string, readonly string[]> {
  const entriesByTarget = new Map<string, Set<string>>();
  const add = (target: string, entry: string) => {
    const known = entriesByTarget.get(target);
    if (known) known.add(entry);
    else entriesByTarget.set(target, new Set([entry]));
  };
  const registryTitles = new Map(
    (graph.auxiliaryDefinitions ?? []).map(({ definitionId, title }) => [definitionId, title]),
  );
  const nodeTitlesByDefinitionId = new Map(
    graph.nodes.flatMap((node) =>
      node.type === "default" && node.layoutContext ? [[node.layoutContext.definitionId, node.title] as const] : [],
    ),
  );
  // Supplier names are not stored on origins: the registry wins, then any node
  // carrying the same definition, and only then a fixed label — a supplier can
  // legitimately sit outside the graph, e.g. when --root focus dropped it.
  const supplierTitle = (definitionId: string): string =>
    registryTitles.get(definitionId) ?? nodeTitlesByDefinitionId.get(definitionId) ?? "outside graph";
  for (const node of graph.nodes) {
    const structured = node.type === "default" ? (node.layoutContext?.origins ?? []) : [];
    for (const origin of structured) {
      add(
        projectedComponentStructureNodeId(node),
        `from ${supplierTitle(origin.supplierDefinitionId)} (${origin.slot})`,
      );
    }
    if (structured.length > 0) continue;
    for (const edge of graph.edges) {
      const nodeId = projectedComponentStructureNodeId(node);
      if (edge.target !== nodeId || !edge.label) continue;
      add(nodeId, edge.label);
    }
  }
  return new Map([...entriesByTarget].map(([target, entries]) => [target, [...entries].toSorted()]));
}

type ComponentGuardLabelsProps = Readonly<{
  graph: ProjectedComponentStructureGraph;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  /** Routes whose condition holds under the current selection — their icon stays lit. */
  activeEdges: ReadonlySet<string>;
  onSelect: (edgeId: string, controlId: string, value: string) => void;
}>;

// A route's full activation condition rides one combined label. Branch arms
// (edges leaving a decision node) label near their start so the case reads
// beside the control that owns it; every other route labels near its arrival,
// growing back up the edge. Clicking the label applies that route's whole rule;
// highlighting reports into the shared channel, and the canvas decides what lights.
export function attachGuardLabels({
  graph,
  controls,
  layout,
  edges,
  activeEdges,
  onSelect,
}: ComponentGuardLabelsProps): DiagramReactFlowEdge[] {
  const graphEdgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const pointsByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge.points]));
  const controlIds = new Set(controls.map((control) => control.controlId));
  // Route-bearing edges get one combined label; the decoration pass below
  // needs the anchor for each, so collect them first.
  const labeled = edges.flatMap((edge) => {
    if (edge.type !== "connection" || !edge.data) return [];
    const graphEdge = graphEdgeById.get(edge.id);
    const guards = graphEdge?.guards;
    // Guards may hold only empty rules (an unconditional edge); those carry
    // no condition to state.
    if (!guards || !guards.some((rule) => rule.length > 0)) return [];
    const points = pointsByEdgeId.get(edge.id) ?? [];
    const from: "start" | "end" = graphEdge != null && controlIds.has(graphEdge.source) ? "start" : "end";
    const text = routeConditionText(controls, guards);
    return [
      {
        edge,
        guards,
        from,
        points,
        text,
      },
    ];
  });
  // Labels sharing an anchor region — same-branch arms especially — resolve
  // by pushing along their own edge, away from the node they leave or reach.
  const anchors = layoutComponentGuardLabels(
    labeled.map(({ edge, from, points, text }) => ({
      edgeId: edge.id,
      from,
      points,
      fallback: edge.data!.labelPosition,
      text,
    })),
    layout.nodes.map((node) => ({ x: node.position.x, y: node.position.y, ...node.size })),
  );
  return edges.map((edge) => {
    const label = labeled.find((item) => item.edge.id === edge.id);
    if (!label || edge.type !== "connection" || !edge.data) return edge;
    const anchor = anchors.get(edge.id)!;
    const representative = label.guards.at(0)?.at(0);
    const Icon = routeConditionIncludesBranch(controls, label.guards) ? Split : Check;
    return {
      ...edge,
      data: {
        ...edge.data,
        labelControls: [
          {
            // Branch arms hang downstream of the start anchor; arrival labels
            // climb back up from the end anchor, each away from its node.
            anchorSide: label.from === "start" ? ("top" as const) : ("bottom" as const),
            control: (
              <BaseEdgeLabel
                active={activeEdges.has(edge.id)}
                ariaLabel={`Route condition: ${label.text}`}
                icon={<Icon data-icon="inline-start" />}
                onSelect={() => {
                  if (representative) onSelect(edge.id, representative.controlId, representative.value);
                }}
                onHighlightChange={(highlighted) => {
                  if (highlighted) reportEdgeHighlight({ kind: "label", edgeId: edge.id });
                  else clearEdgeHighlight({ kind: "label", edgeId: edge.id });
                }}
                text={label.text}
              />
            ),
            position: anchor,
          },
        ],
      },
    };
  });
}

function toDecisionNodeData(node: ProjectedDecisionNode): DiamondReactFlowNode["data"] {
  return {
    accessibleLabel: node.title,
    ports: node.control.cases.map(({ caseId }) => caseId),
  };
}

/** Measurement and placement consume the same display projection. */
export function buildComponentStructureMeasurementNodes(
  graph: ProjectedComponentStructureGraph,
  onOpenSource: (href: string) => void,
): DiagramReactFlowNode[] {
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  return graph.nodes.map((node) => {
    const common = {
      id: projectedComponentStructureNodeId(node),
      position: { x: 0, y: 0 },
      draggable: false,
      focusable: false,
      selectable: false,
      style: { opacity: 0, pointerEvents: "none" },
    } as const;
    if (node.type === "decision") {
      return { ...common, type: "diamond", data: toDecisionNodeData(node) };
    }
    return {
      ...common,
      type: "rectangle",
      data: toRectangleNodeData(node, onLinkActivate),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

export function buildComponentStructureReactFlowNodes(
  graph: ProjectedComponentStructureGraph,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowNode[] {
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const groups = buildDiagramReactFlowGroups(graph.groups, layout);
  const nodes = layout.nodes.map<DiagramReactFlowNode>((placement) => {
    const node = graph.nodes.find((candidate) => projectedComponentStructureNodeId(candidate) === placement.id);
    if (!node) throw new Error(`Layout result references an unknown diagram node: ${placement.id}`);
    const common = {
      id: projectedComponentStructureNodeId(node),
      position: placement.position,
      ...(placement.parentId ? { parentId: placement.parentId } : {}),
      style: { width: placement.size.width, height: placement.size.height },
      draggable: false,
      focusable: false,
      selectable: false,
    } as const;
    if (node.type === "decision") {
      return { ...common, type: "diamond", data: toDecisionNodeData(node) };
    }
    return {
      ...common,
      type: "rectangle",
      data: toRectangleNodeData(node, onLinkActivate),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  return [...groups, ...nodes];
}

function toEdgePath(placement: DiagramLayoutEdge): string {
  if (placement.routing === "spline") return toSplinePath(placement.points);
  if (placement.routing === "bezier") return toBezierPath(placement.points);
  return toPolylinePath(placement.points);
}

// The highlight preview for one route: what would have to change to run the
// route's rule, stated as before → after per control and grouped under the
// component that owns each control. An empty list means the route already
// holds.
function RouteChangesPreview({ changes }: Readonly<{ changes: readonly RouteConditionChange[] }>) {
  const groups = new Map<string, RouteConditionChange[]>();
  for (const change of changes) {
    const known = groups.get(change.ownerLabel);
    if (known) known.push(change);
    else groups.set(change.ownerLabel, [change]);
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="font-semibold text-muted-foreground">To run this route</p>
      {changes.length === 0 ? (
        <p className="text-muted-foreground">This route already holds.</p>
      ) : (
        [...groups].map(([ownerLabel, owned]) => (
          <section key={ownerLabel}>
            <h4 className="font-medium text-muted-foreground">{ownerLabel}</h4>
            <ul className="flex flex-col gap-1">
              {owned.map((change) => (
                <li className="flex items-baseline justify-between gap-2" key={change.controlId}>
                  <span className="truncate">{change.label}</span>
                  <span className="shrink-0 font-mono">
                    {change.before} <span aria-hidden="true">→</span> {change.after}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ComponentStructureContent(props: DiagramRendererProps) {
  const { artifact } = props;
  // The projection owns everything display-only: decision nodes, split
  // segments, guards, and non-component nodes.
  const projected = useMemo(
    () => (isComponentStructureArtifact(artifact) ? projectDecisionNodes(artifact.diagram.graph) : null),
    [artifact],
  );
  const calculateLayout = useCallback(
    (layoutArtifact: Artifact, nodeSizes: DiagramNodeSizes) => {
      if (!projected || !isComponentStructureArtifact(layoutArtifact))
        throw new Error("Expected a component structure diagram layout.");
      return layoutComponentStructureDiagram(projected, nodeSizes, layoutArtifact.diagram.layout.options);
    },
    [projected],
  );
  const controls = useMemo(() => projected?.controls ?? [], [projected]);
  const initialSelection = useMemo(() => (projected ? initialComponentSelection(projected) : {}), [projected]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  // Labels report highlights into the shared channel; the changes preview
  // reads the same origin the canvas lights the edge from.
  const [highlightOrigin, setHighlightOrigin] = useState<EdgeHighlightOrigin | null>(null);
  useEffect(() => subscribeEdgeHighlight(setHighlightOrigin), []);
  const highlightedEdgeId = highlightOrigin?.kind === "label" ? highlightOrigin.edgeId : null;

  // Label clicks drive a route's whole rule; owner fields set one control's
  // value directly. Both land in the same selection state.
  const onSelect = useCallback(
    (edgeId: string, controlId: string, value: string) => {
      if (!projected) return;
      setSelection((current) => selectEdgePath(projected, current, edgeId, controlId, value));
    },
    [projected],
  );
  const onControlSelect = useCallback(
    (controlId: string, value: string) => {
      if (!projected) return;
      setSelection((current) => selectComponentPath(projected, current, controlId, value));
    },
    [projected],
  );

  const controlsByOwner = useMemo(() => {
    const byOwner = new Map<string, DiagramControl[]>();
    for (const control of controls) {
      const known = byOwner.get(control.ownerNodeId);
      if (known) known.push(control);
      else byOwner.set(control.ownerNodeId, [control]);
    }
    return byOwner;
  }, [controls]);

  const decorateNodes = useCallback(
    (nodes: readonly DiagramReactFlowNode[], selected: ComponentSelection): DiagramReactFlowNode[] => {
      if (!projected) return [...nodes];
      const emphasis = componentPathEmphasis(projected, selected);
      const origins = collectComponentOrigins(projected);
      return nodes.map((node) => {
        const active = emphasis.nodes.has(node.id);
        if (node.type === "diamond") {
          return {
            ...node,
            data: {
              ...node.data,
              active,
              accessibleDescription: active ? undefined : "Inactive path",
            },
          };
        }
        if (node.type !== "rectangle") return node;
        const nodeOrigins = origins.get(node.id) ?? [];
        // Every owned control renders its field on the owning card — branch
        // cases as a single-choice select, conditionals as switches — so
        // owned values live in one place.
        const ownedControls = controlsByOwner.get(toDefinitionId(node.id)) ?? [];
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? undefined : "Inactive path",
            className: active ? undefined : "border-dashed bg-muted/50 opacity-50",
            details: [...(node.data.details ?? []), ...nodeOrigins],
            // Hovering nodes stays quiet: the changes preview belongs to
            // guard edge labels, which name the exact rule they show.
            children:
              ownedControls.length > 0 ? (
                <div
                  className="nodrag nopan mt-3 flex max-w-full flex-col gap-1.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  {ownedControls.map((control) => {
                    const pair = getPolarityPairCases(control);
                    return control.type === "branch" && !pair ? (
                      <label className="flex items-center justify-between gap-2 text-xs" key={control.controlId}>
                        <span className="truncate">{control.label}</span>
                        <Select
                          items={Object.fromEntries(
                            control.cases.map((branchCase) => [branchCase.caseId, branchCase.label]),
                          )}
                          onValueChange={(next) => {
                            if (next != null) onControlSelect(control.controlId, next);
                          }}
                          value={selected[control.controlId] ?? null}
                        >
                          <SelectTrigger aria-label={control.label}>
                            <SelectValue />
                            <SelectIcon />
                          </SelectTrigger>
                          <SelectPortal>
                            <SelectPositioner>
                              <SelectPopup>
                                {control.cases.map((branchCase) => (
                                  <SelectItem key={branchCase.caseId} value={branchCase.caseId}>
                                    <SelectItemIndicator />
                                    <SelectItemText>{branchCase.label}</SelectItemText>
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </SelectPositioner>
                          </SelectPortal>
                        </Select>
                      </label>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-xs" key={control.controlId}>
                        <span className="truncate">{control.label}</span>
                        <Switch
                          checked={selected[control.controlId] === (pair?.onCase.caseId ?? "on")}
                          onCheckedChange={(checked) => {
                            onControlSelect(
                              control.controlId,
                              checked ? (pair?.onCase.caseId ?? "on") : (pair?.offCase.caseId ?? "off"),
                            );
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : undefined,
          },
        };
      });
    },
    [controlsByOwner, onControlSelect, projected],
  );
  const buildMeasurementNodes = useCallback(
    (measuredArtifact: Artifact, onOpenSource: (href: string) => void) => {
      if (!isComponentStructureArtifact(measuredArtifact)) throw new Error("Expected a component structure layout.");
      return decorateNodes(buildComponentStructureMeasurementNodes(projected!, onOpenSource), initialSelection);
    },
    [decorateNodes, initialSelection, projected],
  );
  const buildRenderModel = useCallback(
    (
      renderedArtifact: Artifact,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ): DiagramReactFlowRenderModel => {
      if (!projected || !isComponentStructureArtifact(renderedArtifact)) {
        throw new Error("Expected a component structure layout.");
      }
      const emphasis = componentPathEmphasis(projected, selection);
      const model: DiagramReactFlowRenderModel = {
        nodes: buildComponentStructureReactFlowNodes(projected, layout, onOpenSource),
        // Projected edges carry no display fields: their condition rides the
        // guard labels, so the routes themselves stay bare.
        edges: layout.edges.map<DiagramReactFlowEdge>((placement) => {
          const edge = projected.edges.find(({ id }) => id === placement.id);
          if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            focusable: false,
            selectable: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
            style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
            type: "connection",
            data: {
              path: toEdgePath(placement),
              labelPosition:
                placement.points.length > 1
                  ? getPolylineEdgeLabelPlacement(placement.points)
                  : (placement.points.at(0) ?? { x: 0, y: 0 }),
            },
          };
        }),
      };
      const dimmed = model.edges.map((edge) => {
        const ariaLabel = `${edge.source} to ${edge.target}${emphasis.edges.has(edge.id) ? "" : ": Inactive path"}`;
        const style = { ...edge.style, opacity: emphasis.edges.has(edge.id) ? 1 : 0.25 };
        return { ...edge, ariaLabel, style };
      });
      const edges = attachGuardLabels({
        controls,
        edges: dimmed,
        graph: projected,
        layout,
        activeEdges: emphasis.edges,
        onSelect,
      });
      return {
        ...model,
        nodes: decorateNodes(model.nodes, selection),
        edges,
      };
    },
    [controls, decorateNodes, onSelect, projected, selection],
  );

  return (
    <DiagramView
      {...props}
      calculateLayout={calculateLayout}
      buildMeasurementNodes={buildMeasurementNodes}
      buildRenderModel={buildRenderModel}
      referencePanel={
        highlightedEdgeId != null && projected ? (
          <ReferencePanel aria-label="Route changes" className="pointer-events-none">
            <RouteChangesPreview changes={describeRouteSelectionChange(projected, selection, highlightedEdgeId)} />
          </ReferencePanel>
        ) : null
      }
    />
  );
}

export function ComponentStructureDiagramRenderer(props: DiagramRendererProps) {
  return <ComponentStructureContent key={JSON.stringify(props.artifact)} {...props} />;
}
