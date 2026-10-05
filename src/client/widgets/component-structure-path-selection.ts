import type {
  DiagramControl,
  DiagramEdge,
  DiagramGraph,
  DiagramRouteRequirement,
  DiagramRouteRequirementRule,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";

export type ComponentSelection = Readonly<Record<string, string>>;

// Depth counts SCCs, so recursion cannot make an alternative infinitely deep.
function condensedComponents(graph: DiagramGraph): ReadonlyMap<string, number> {
  const indices = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components = new Map<string, number>();
  let index = 0;
  let component = 0;
  const outgoing = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.source === node.id)]));
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
  for (const node of graph.nodes) if (!indices.has(node.id)) visit(node.id);
  return components;
}

function routeMetrics(
  graph: DiagramGraph,
  components: ReadonlyMap<string, number>,
  starts: readonly DiagramEdge[],
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
    // other edges keep their authored id: projected arm ids are hashes, but
    // the case they leave from is the stable, authored ordering.
    edgeId:
      starts
        .map((edge) => (edge.type === "default" && edge.sourcePort ? edge.sourcePort : edge.id))
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
      const control = controls.find((item) => item.id === controlId)!;
      return (
        reachableNodes.has(control.owner) &&
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

function ancestorRoutes(graph: DiagramGraph, nodeId: string, visited = new Set<string>()): RouteCandidate[] {
  if (graph.roots!.includes(nodeId)) return [{ requirements: new Map(), edges: [] }];
  if (visited.has(nodeId)) return [];
  const nextVisited = new Set([...visited, nodeId]);
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .flatMap((edge) =>
      ancestorRoutes(graph, edge.source, nextVisited).flatMap((ancestor) =>
        (edge.type === "default" ? (edge.activeWhen ?? [[]]) : [[]]).flatMap((rule) => {
          const merged = mergeRequirements(ancestor, rule);
          return merged ? [{ ...merged, edges: [...ancestor.edges, edge.id] }] : [];
        }),
      ),
    );
}

function withPrerequisites(
  graph: DiagramGraph,
  candidate: RouteCandidate,
  expanded = new Set<string>(),
): RouteCandidate[] {
  const pending = [...candidate.requirements.keys()].find((controlId) => !expanded.has(controlId));
  if (pending === undefined) return [candidate];
  const control = graph.controls!.find((item) => item.id === pending)!;
  const nextExpanded = new Set([...expanded, pending]);
  return control.dependsOn.flatMap((rule) => {
    const merged = mergeRequirements(candidate, rule);
    return merged ? withPrerequisites(graph, merged, nextExpanded) : [];
  });
}

function branchMetrics(graph: DiagramGraph, control: DiagramControl, value: string) {
  const routesByEdge = new Map(
    graph.edges.map((edge) => [
      edge.id,
      (edge.type === "default" ? (edge.activeWhen ?? [[]]) : [[]]).flatMap((rule) =>
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
      const required = route.requirements.get(control.id);
      return required === undefined || required === value;
    }),
  );
  const reachable = new Set(graph.roots!);
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
    routesByEdge.get(edge.id)!.some((route) => route.requirements.get(control.id) === value),
  );
  return routeMetrics(candidateGraph, condensedComponents(candidateGraph), starts, control.owner);
}

export function initialComponentSelection(graph: DiagramGraph): ComponentSelection {
  return Object.fromEntries(
    graph.controls!.map((control) => {
      if (control.kind === "conditional") return [control.id, "off"];
      const cases = control.cases.map((alternative) => ({
        ...alternative,
        metrics: branchMetrics(graph, control, alternative.id),
      }));
      cases.sort((left, right) => compareMetrics(left.metrics, right.metrics));
      return [control.id, cases.at(0)!.id];
    }),
  );
}

export function componentPathEmphasis(graph: DiagramGraph, selection: ComponentSelection) {
  const controls = graph.controls!;
  const nodes = new Set(graph.roots!);
  const edges = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (!nodes.has(edge.source)) continue;
      if (edge.type === "default" && !componentRulesetHolds(edge.activeWhen ?? [[]], selection, controls, nodes))
        continue;
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
        (control) => nodes.has(control.owner) && componentRulesetHolds(control.dependsOn, selection, controls, nodes),
      )
      .map((control) => control.id),
  );
  return { nodes, edges, controls: activeControls };
}

function withReachableOwners(
  graph: DiagramGraph,
  selection: ComponentSelection,
  candidate: RouteCandidate,
  attemptedSources = new Set<string>(),
): RouteCandidate[] {
  const selected = { ...selection, ...Object.fromEntries(candidate.requirements) };
  const reachable = componentPathEmphasis(graph, selected).nodes;
  const missingSources = [
    ...new Set(
      [...candidate.requirements.keys()].map(
        (controlId) => graph.controls!.find((control) => control.id === controlId)!.owner,
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

export function selectComponentPath(
  graph: DiagramGraph,
  selection: ComponentSelection,
  controlId: string,
  value: string,
): ComponentSelection {
  const selected = { ...selection, [controlId]: value };
  const control = graph.controls!.find((item) => item.id === controlId)!;
  const emphasis = componentPathEmphasis(graph, selected);
  if (control.kind === "conditional") {
    if (value === "off" || emphasis.controls.has(control.id)) return selected;
  } else {
    // A branch needs rerouting only when its arm is unreachable: the control
    // being active just means its owner renders, while the arm leaves the
    // decision node, whose incoming chain may stay gated by other choices.
    const armActive = graph.edges.some(
      (edge) =>
        edge.type === "default" &&
        edge.source === controlId &&
        edge.sourcePort === value &&
        emphasis.edges.has(edge.id),
    );
    if (armActive) return selected;
  }
  // Branch arms reroute to the decision node itself — its incoming chain names
  // the choices that must hold before the arm exists. Conditional controls own
  // no node, so they reroute to their owner.
  const rerouteTarget = control.kind === "branch" ? control.id : control.owner;
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
  return chosen ? { ...selected, ...Object.fromEntries(chosen.requirements) } : selected;
}

// Turning a satisfied rule off keeps the requirements that other active
// rules also name — their pills stay pressed — so a shared rule ends
// partial rather than off. Only conditional requirements switch off, because a
// branch control always holds one case; a rule with nothing left to spare
// forces off entirely.
function releaseGuardRule(
  graph: DiagramGraph,
  selection: ComponentSelection,
  rule: DiagramRouteRequirementRule,
  activeEdges: ReadonlySet<string>,
  selfEdgeId: string,
  selfIndex: number,
): ComponentSelection {
  const holds = (requirement: DiagramRouteRequirement) => selection[requirement.controlId] === requirement.value;
  const satisfied = graph.edges.flatMap((edge) => {
    if (edge.type !== "default" || !edge.guards || !activeEdges.has(edge.id)) return [];
    return edge.guards
      .map((other, index) => ({ edgeId: edge.id, index, rule: other }))
      .filter((other) => (other.edgeId !== selfEdgeId || other.index !== selfIndex) && other.rule.every(holds));
  });
  const shared = (requirement: DiagramRouteRequirement) =>
    satisfied.some((other) =>
      other.rule.some((item) => item.controlId === requirement.controlId && item.value === requirement.value),
    );
  const switchable = rule.filter(
    (requirement) => graph.controls!.find((control) => control.id === requirement.controlId)?.kind === "conditional",
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
  graph: DiagramGraph,
  selection: ComponentSelection,
  edgeId: string,
  controlId: string,
  value: string,
): ComponentSelection {
  const controls = graph.controls!;
  const control = controls.find((item) => item.id === controlId)!;
  const edge = graph.edges.find((item) => item.type === "default" && item.id === edgeId);
  const guards = edge && edge.type === "default" ? edge.guards : undefined;
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
  if (holds && control.kind === "conditional") {
    const repaired = applyRule(selection);
    const movedBranch = controls.some((item) => item.kind === "branch" && repaired[item.id] !== selection[item.id]);
    const changed = Object.keys(repaired).some((id) => repaired[id] !== selection[id]);
    if (changed && !movedBranch) return repaired;
    return releaseGuardRule(graph, selection, rule!, activeEdges, edgeId, ruleIndex);
  }
  return applyRule(selection);
}
