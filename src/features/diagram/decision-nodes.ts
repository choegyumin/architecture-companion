import { createHash } from "node:crypto";

import { combineControlPaths, unionControlPaths } from "@/features/diagram/diagram-control-paths";
import type {
  DecisionDiagramNode,
  DefaultDiagramEdge,
  DefaultDiagramNode,
  DiagramControl,
  DiagramControlCondition,
  DiagramControlPaths,
  DiagramGraph,
} from "@/features/diagram/diagram-graph";

export const NON_COMPONENT_NODE_ID = "non-component";

type Segment = Readonly<{
  source: string;
  target: string;
  sourcePort?: string;
  guards: DiagramControlPaths;
  activeWhen: DiagramControlPaths;
}>;

function segmentId(segment: Omit<Segment, "guards" | "activeWhen">): string {
  return `edge:${createHash("sha256")
    .update([segment.source, segment.target, segment.sourcePort ?? ""].join("\0"))
    .digest("hex")
    .slice(0, 16)}`;
}

const conditionKey = (condition: DiagramControlCondition): string => `${condition.controlId}\0${condition.value}`;

/**
 * Authored graphs may keep an edge's `activeWhen` local and declare the rest of
 * a control's prerequisites through `dependsOn`. Rendering needs every guard
 * visible, so the projection lifts those prerequisites onto the segment that
 * reaches the control: a decision's entry segment names what must hold before
 * the branch applies, and untraversed conditional prerequisites ride the same
 * edge as the control they gate. Disjunctive prerequisites stay disjunctive —
 * the alternatives spread across guard clauses instead of contradicting.
 */
function missingGuardPaths(
  seeds: readonly DiagramControlCondition[],
  path: readonly DiagramControlCondition[],
  controlsById: ReadonlyMap<string, Pick<DiagramControl, "dependsOn">>,
): DiagramControlPaths {
  const claimed = new Set(path.map(conditionKey));
  const expanded = new Set<string>();
  let results: DiagramControlPaths = [[]];
  const queue = [...seeds];
  while (queue.length > 0) {
    const seed = queue.shift()!;
    if (expanded.has(seed.controlId)) continue;
    expanded.add(seed.controlId);
    const additions = (controlsById.get(seed.controlId)?.dependsOn ?? [[]]).map((dependencyPath) =>
      dependencyPath.filter((dependency) => !claimed.has(conditionKey(dependency))),
    );
    for (const addition of additions) {
      for (const dependency of addition) {
        claimed.add(conditionKey(dependency));
        queue.push(dependency);
      }
    }
    results = combineControlPaths(results, additions);
  }
  return results;
}

/**
 * Splits one path through a branch chain into hop segments. Each branch
 * condition ends a segment at that control's decision node; the segment's
 * `sourcePort` is the previous branch's chosen case, its `guards` carry the
 * conditions the edge label renders (the branch choice plus any surrounding
 * conditional guards), and its `activeWhen` accumulates every condition up to
 * but excluding the branch that ends it.
 */
function segmentsOf(
  path: readonly DiagramControlCondition[],
  edge: DefaultDiagramEdge,
  isBranch: (controlId: string) => boolean,
  controlsById: ReadonlyMap<string, Pick<DiagramControl, "dependsOn">>,
): Segment[] {
  const segments: (Segment & { seeds: DiagramControlCondition[] })[] = [];
  let start = edge.source;
  let startPort: string | undefined;
  let portCondition: DiagramControlCondition | undefined;
  const activeWhen: DiagramControlCondition[] = [];
  let span: DiagramControlCondition[] = [];

  const push = (target: string, reached?: DiagramControlCondition): void => {
    // Snapshot the accumulators: later paths keep mutating them. The label
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

  for (const condition of path) {
    if (!isBranch(condition.controlId)) {
      activeWhen.push(condition);
      span.push(condition);
      continue;
    }
    push(condition.controlId, condition);
    start = condition.controlId;
    startPort = condition.value;
    portCondition = condition;
    activeWhen.push(condition);
    span = [];
  }
  push(edge.target);

  // Lift declared-but-untraversed prerequisites onto the segments that reach
  // their controls, so every guard renders somewhere.
  return segments.map(({ seeds, ...segment }) => {
    const missing = missingGuardPaths(seeds, path, controlsById);
    return { ...segment, guards: combineControlPaths(segment.guards, missing) };
  });
}

/**
 * Projects branch controls as decision nodes. Every branch control gains a
 * decision node whose id is the control's id; edges are re-cut into hops
 * through the chain of decision nodes their paths traverse, with the leaving
 * case as the source port. Branch cases no edge requires route to a shared
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
    for (const path of edge.activeWhen ?? [])
      for (const { controlId, value } of path) alivePairs.add(`${controlId}\0${value}`);
  }

  const edgesById = new Map<string, DefaultDiagramEdge>();
  const segments = new Map<string, Segment & { kind?: string; label?: string; href?: string }>();
  for (const edge of graph.edges) {
    if (edge.type !== "default") continue;
    const paths = edge.activeWhen ?? [[]];
    const branchless = paths.filter((path) => !path.some(({ controlId }) => branchControlIds.has(controlId)));
    const branched = paths.filter((path) => path.some(({ controlId }) => branchControlIds.has(controlId)));

    if (branchless.length > 0) {
      // The edge stays whole: no branch ever cuts it, so its guards are the
      // plain conjunctions of its own paths plus their untraversed prerequisites.
      edgesById.set(edge.id, {
        ...edge,
        activeWhen: branchless.length === paths.length ? edge.activeWhen : branchless,
        guards: branchless.flatMap((path) => combineControlPaths([path], missingGuardPaths(path, path, controlsById))),
      });
    }
    for (const path of branched) {
      for (const segment of segmentsOf(path, edge, branchControlIds.has.bind(branchControlIds), controlsById)) {
        const key = [segment.source, segment.target, segment.sourcePort ?? ""].join("\0");
        const existing = segments.get(key);
        const terminal = segment.target === edge.target;
        if (!existing) {
          segments.set(key, {
            ...segment,
            guards: unionControlPaths(segment.guards),
            activeWhen: unionControlPaths(segment.activeWhen),
            ...(terminal ? { kind: edge.kind, label: edge.label, href: edge.href } : {}),
          });
          continue;
        }
        segments.set(key, {
          ...existing,
          guards: unionControlPaths(existing.guards, segment.guards),
          activeWhen: unionControlPaths(existing.activeWhen, segment.activeWhen),
        });
      }
    }
  }

  // Dead arms: a case no edge in the graph requires renders no component, so
  // it routes to the shared Non-component node and stays selectable.
  const deadArms: (Segment & { kind?: string; label?: string; href?: string })[] = [];
  for (const control of branchControls) {
    for (const branchCase of control.cases) {
      if (alivePairs.has(`${control.id}\0${branchCase.id}`)) continue;
      deadArms.push({
        source: control.id,
        target: NON_COMPONENT_NODE_ID,
        sourcePort: branchCase.id,
        guards: [[{ controlId: control.id, value: branchCase.id }]],
        activeWhen: control.dependsOn.map((path) => [...path, { controlId: control.id, value: branchCase.id }]),
      });
    }
  }

  const decisionNodes: DecisionDiagramNode[] = branchControls.map((control) => ({
    type: "decision",
    id: control.id,
    title: control.label,
  }));
  const nonComponentNode: DefaultDiagramNode | undefined =
    deadArms.length > 0 ? { type: "default", id: NON_COMPONENT_NODE_ID, title: "Non-component" } : undefined;

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

  const nodes = [...graph.nodes, ...decisionNodes, ...(nonComponentNode ? [nonComponentNode] : [])];
  return {
    ...graph,
    nodes: nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgesById.values(), ...projectedEdges].toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}
