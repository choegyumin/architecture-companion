import { createHash } from "node:crypto";

import { unionControlPaths } from "@/features/diagram/diagram-control-paths";
import type {
  DecisionDiagramNode,
  DefaultDiagramEdge,
  DefaultDiagramNode,
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
): Segment[] {
  const segments: Segment[] = [];
  let start = edge.source;
  let startPort: string | undefined;
  const activeWhen: DiagramControlCondition[] = [];
  let guards: DiagramControlCondition[] = [];

  const push = (target: string): void => {
    // Snapshot the accumulators: later paths keep mutating them.
    segments.push({
      source: start,
      target,
      ...(startPort ? { sourcePort: startPort } : {}),
      guards: [[...guards]],
      activeWhen: [[...activeWhen]],
    });
  };

  for (const condition of path) {
    if (!isBranch(condition.controlId)) {
      activeWhen.push(condition);
      guards.push(condition);
      continue;
    }
    push(condition.controlId);
    start = condition.controlId;
    startPort = condition.value;
    activeWhen.push(condition);
    guards = [condition];
  }
  push(edge.target);
  return segments;
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
      // plain conjunctions of its own paths.
      edgesById.set(edge.id, {
        ...edge,
        activeWhen: branchless.length === paths.length ? edge.activeWhen : branchless,
        guards: branchless,
      });
    }
    for (const path of branched) {
      for (const segment of segmentsOf(path, edge, (controlId) => branchControlIds.has(controlId))) {
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
