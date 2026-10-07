import z from "zod";

import {
  centerOf,
  clipSegment,
  ELK_ROOT_ID,
  type ElkCoreDirection,
  elkOptionMapSchema,
  expanded,
  layoutWithElkCore,
  lerp,
  type Plane,
  planeFor,
  type Rect,
  resolveElkLayeredOptions,
  resolveGroupOrigins,
  shiftRect,
  toElkChildrenTree,
  toElkViewportPolicy,
  toNodeRects,
  toPlainElkNode,
} from "@/features/diagram/_layout/elk-core";
import type {
  ProjectedComponentStructureGraph,
  ProjectedComponentStructureNode,
} from "@/features/diagram/decision-nodes";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";

/*
 * Component structure layout: layered placement through the shared ELK core,
 * with decision-node geometry of its own (ADR 0003). Decision diamonds anchor
 * every edge on their outline - arms leave through per-case ports, entries
 * arrive at the upstream tip, and reverse edges ride the slopes.
 */

export const componentStructureDiagramLayoutConfigSchema = z
  .object({
    id: z.literal("component-structure"),
    options: z
      .object({
        nudgeObstacleNodes: z.boolean().optional(),
        bezierEdges: z.boolean().optional(),
        elk: elkOptionMapSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ComponentStructureDiagramLayoutConfig = z.infer<typeof componentStructureDiagramLayoutConfigSchema>;

// elkjs resolves edge sources against every node and port id in the graph, so
// port ids must be globally unique: case ids alone collide across decision
// nodes and every arm would bind to whichever node declared that id first.
function elkPortId(nodeId: string, caseId: string): string {
  return `${nodeId}\u0000${caseId}`;
}

// The diamond outline the decision node renders, as [north, east, south, west]
// vertices, matching the polygon in decision-node.tsx.
function diamondVertices(rect: Rect): [DiagramLayoutPoint, DiagramLayoutPoint, DiagramLayoutPoint, DiagramLayoutPoint] {
  const { min, max } = rect;
  return [
    { x: (min.x + max.x) / 2, y: min.y + 2 },
    { x: max.x - 2, y: (min.y + max.y) / 2 },
    { x: (min.x + max.x) / 2, y: max.y - 2 },
    { x: min.x + 2, y: (min.y + max.y) / 2 },
  ];
}

// Decision nodes anchor every edge on the diamond, UML-style: forward arms
// leave through dedicated vertices — the two sides and the downstream tip, in
// case order — so arms to the same target never share one route, while
// forward entries arrive at the upstream tip. Reverse edges re-anchor onto
// the diamond's slopes after layout (see reverseDecisionAnchors).
const DECISION_ENTRY_PORT = "\u0000entry";

// The diamond's corners in direction-relative terms: which sides flank the
// flow, and which tips point downstream and upstream.
type DecisionCorners = Readonly<{
  sideA: DiagramLayoutPoint;
  sideB: DiagramLayoutPoint;
  downstream: DiagramLayoutPoint;
  upstream: DiagramLayoutPoint;
}>;

function decisionCorners(rect: Rect, direction: ElkCoreDirection): DecisionCorners {
  const [north, east, south, west] = diamondVertices(rect);
  return direction === "DOWN"
    ? { sideA: west, sideB: east, downstream: south, upstream: north }
    : direction === "UP"
      ? { sideA: west, sideB: east, downstream: north, upstream: south }
      : direction === "RIGHT"
        ? { sideA: north, sideB: south, downstream: east, upstream: west }
        : { sideA: north, sideB: south, downstream: west, upstream: east };
}

// A point on one of the diamond's slopes: an upstream slope (beside the entry
// tip) hosts reverse departures, a downstream slope hosts reverse arrivals.
function slopePoint(
  corners: DecisionCorners,
  boundary: "upstream" | "downstream",
  side: "A" | "B",
  t: number,
): DiagramLayoutPoint {
  return boundary === "upstream"
    ? lerp(corners.upstream, side === "A" ? corners.sideA : corners.sideB, t)
    : side === "A"
      ? lerp(corners.sideA, corners.downstream, t)
      : lerp(corners.downstream, corners.sideB, t);
}

function toElkNode(node: ProjectedComponentStructureNode, nodeSizes: DiagramNodeSizes, direction: ElkCoreDirection) {
  const size = toPlainElkNode(node, nodeSizes);
  if (node.type !== "decision") return size;
  const control = node.control;

  const corners = decisionCorners(
    { id: node.id, min: { x: 0, y: 0 }, max: { x: size.width ?? 0, y: size.height ?? 0 } },
    direction,
  );
  // The first three cases leave through the side and downstream vertices in
  // case order; further cases spread along the two downstream slopes by arc
  // length so every case keeps its own anchor.
  const anchorOf = (index: number): DiagramLayoutPoint => {
    if (index < 3) return [corners.sideA, corners.sideB, corners.downstream][index]!;
    const spread = control.cases.length - 3;
    const t = ((index - 3 + 1) / (spread + 1)) * 2;
    return t <= 1 ? lerp(corners.sideA, corners.downstream, t) : lerp(corners.downstream, corners.sideB, t - 1);
  };
  const ports = control.cases.map((branchCase, index) => {
    const anchor = anchorOf(index);
    return { id: elkPortId(node.id, branchCase.id), width: 4, height: 4, x: anchor.x - 2, y: anchor.y - 2 };
  });
  ports.push({
    id: elkPortId(node.id, DECISION_ENTRY_PORT),
    width: 4,
    height: 4,
    x: corners.upstream.x - 2,
    y: corners.upstream.y - 2,
  });
  return {
    ...size,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports,
  };
}

// The diamond vertex a `direction` flow enters through: the upstream tip.
function upstreamVertex(rect: Rect, direction: ElkCoreDirection): DiagramLayoutPoint {
  const [north, east, south, west] = diamondVertices(rect);
  return direction === "DOWN" ? north : direction === "UP" ? south : direction === "RIGHT" ? west : east;
}

// A decision arm's ELK route starts at its port anchor; nudging may shift the
// decision node afterwards, so the anchor is an offset from the node's original
// top-left corner, rebased onto whatever rect the node holds now.
function portAnchorOf(
  edge: ProjectedComponentStructureGraph["edges"][number],
  placement: DiagramLayoutEdge | undefined,
  rects: ReadonlyMap<string, Rect>,
  originalRects: ReadonlyMap<string, Rect>,
): DiagramLayoutPoint | undefined {
  if (!placement || !edge.sourcePort || placement.points.length === 0) return undefined;
  const original = originalRects.get(edge.source);
  const current = rects.get(edge.source);
  if (!original || !current) return undefined;
  const anchor = placement.points.at(0)!;
  return {
    x: current.min.x + (anchor.x - original.min.x),
    y: current.min.y + (anchor.y - original.min.y),
  };
}

// Where the straight sightline enters its target: cards clip at the
// bounding-box border, while diamonds take every entry at their upstream
// vertex — the mirror of where the arms leave.
function targetEntryOf(
  start: DiagramLayoutPoint,
  target: Rect,
  targetCenter: DiagramLayoutPoint,
  vertex: DiagramLayoutPoint | undefined,
): DiagramLayoutPoint {
  if (vertex) return vertex;
  const clipped = clipSegment(start, targetCenter, target);
  return lerp(start, targetCenter, clipped ? clipped.at(0)! : 1);
}

// Reverse edges — their target sits upstream of their source — leave and
// enter decision diamonds through the slopes instead of the flow vertices, so
// the anchor itself tells a reverse edge apart from forward arms and it never
// slides along the diamond's face. Departures take the upstream slopes of the
// source, arrivals the downstream slopes of the target; each slope spreads
// its edges evenly, on the side that faces the other endpoint.
function reverseDecisionAnchors(
  graph: ProjectedComponentStructureGraph,
  rects: ReadonlyMap<string, Rect>,
  direction: ElkCoreDirection,
): Readonly<{ departures: Map<string, DiagramLayoutPoint>; arrivals: Map<string, DiagramLayoutPoint> }> {
  const plane: Plane = planeFor(direction);
  const flowSign = direction === "UP" || direction === "LEFT" ? -1 : 1;
  const decisionIds = new Set(graph.nodes.filter((node) => node.type === "decision").map(({ id }) => id));
  const facingSide = (rect: Rect, other: Rect): "A" | "B" =>
    plane.secondary(centerOf(other)) >= plane.secondary(centerOf(rect)) ? "B" : "A";
  const isReverse = (edge: ProjectedComponentStructureGraph["edges"][number]): boolean => {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) return false;
    return (plane.primary(centerOf(target)) - plane.primary(centerOf(source))) * flowSign < -1;
  };

  const departuresBySlope = new Map<string, ProjectedComponentStructureGraph["edges"][number][]>();
  const arrivalsBySlope = new Map<string, ProjectedComponentStructureGraph["edges"][number][]>();
  for (const edge of graph.edges) {
    if (!isReverse(edge)) continue;
    if (decisionIds.has(edge.source)) {
      const slope = `${edge.source}\0${facingSide(rects.get(edge.source)!, rects.get(edge.target)!)}`;
      departuresBySlope.set(slope, [...(departuresBySlope.get(slope) ?? []), edge]);
    }
    if (decisionIds.has(edge.target)) {
      const slope = `${edge.target}\0${facingSide(rects.get(edge.target)!, rects.get(edge.source)!)}`;
      arrivalsBySlope.set(slope, [...(arrivalsBySlope.get(slope) ?? []), edge]);
    }
  }

  const departures = new Map<string, DiagramLayoutPoint>();
  for (const [slope, edges] of departuresBySlope) {
    const [nodeId, side] = slope.split("\u0000") as [string, "A" | "B"];
    const corners = decisionCorners(rects.get(nodeId)!, direction);
    edges.forEach((edge, index) =>
      departures.set(edge.id, slopePoint(corners, "upstream", side, (index + 1) / (edges.length + 1))),
    );
  }
  const arrivals = new Map<string, DiagramLayoutPoint>();
  for (const [slope, edges] of arrivalsBySlope) {
    const [nodeId, side] = slope.split("\u0000") as [string, "A" | "B"];
    const corners = decisionCorners(rects.get(nodeId)!, direction);
    edges.forEach((edge, index) =>
      arrivals.set(edge.id, slopePoint(corners, "downstream", side, (index + 1) / (edges.length + 1))),
    );
  }
  return { departures, arrivals };
}

// Re-anchors reverse decision edges in a plain ELK layout: only the first and
// last path points move onto the diamond slopes, the routed middle stays.
function reAnchorReverseDecisionEdges(
  graph: ProjectedComponentStructureGraph,
  layout: DiagramLayout,
  direction: ElkCoreDirection,
): DiagramLayout {
  const anchors = reverseDecisionAnchors(graph, toNodeRects(layout.nodes, layout.groups), direction);
  if (anchors.departures.size === 0 && anchors.arrivals.size === 0) return layout;
  return {
    ...layout,
    edges: layout.edges.map((placement) => {
      const departure = anchors.departures.get(placement.id);
      const arrival = anchors.arrivals.get(placement.id);
      if (!departure && !arrival) return placement;
      const points = [...placement.points];
      if (departure) points[0] = departure;
      if (arrival) points[points.length - 1] = arrival;
      return { ...placement, points };
    }),
  };
}

// Opt-in obstacle nudging, shared constants with the layered straightener:
// obstacles blocking an arm's sightline shift aside along the cross axis,
// clamped inside their group.
const OBSTACLE_MARGIN = 16;
const CLEARANCE = 40;
const GROUP_CLEARANCE = 16;

function toStraightEdges(
  graph: ProjectedComponentStructureGraph,
  layout: DiagramLayout,
  rects: ReadonlyMap<string, Rect>,
  direction: ElkCoreDirection,
): DiagramLayoutEdge[] {
  const originalRects = toNodeRects(layout.nodes, layout.groups);
  const decisionVertices = new Map(
    graph.nodes
      .filter((node) => node.type === "decision")
      .map((node) => [node.id, upstreamVertex(rects.get(node.id)!, direction)] as const),
  );
  const reverse = reverseDecisionAnchors(graph, rects, direction);
  return layout.edges.map<DiagramLayoutEdge>((placement) => {
    const edge = graph.edges.find(({ id }) => id === placement.id);
    if (!edge) return placement;
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) return placement;

    // Arms leave from their port anchor — or, when reverse, from the upstream
    // slope the reverse anchors picked; other edges cut the sightline at the
    // source border as before. Reverse arrivals enter through the downstream
    // slope, everything else at the upstream vertex.
    const portAnchor = portAnchorOf(edge, placement, rects, originalRects);
    const targetCenter = centerOf(target);
    const entry = reverse.arrivals.get(edge.id) ?? decisionVertices.get(edge.target);
    if (portAnchor) {
      const start = reverse.departures.get(edge.id) ?? portAnchor;
      return { id: placement.id, points: [start, targetEntryOf(start, target, targetCenter, entry)] };
    }
    const sourceCenter = centerOf(source);
    const [, sourceExit] = clipSegment(sourceCenter, targetCenter, source) ?? [0, 1];
    return {
      id: placement.id,
      points: [
        lerp(sourceCenter, targetCenter, sourceExit ?? 1),
        targetEntryOf(sourceCenter, target, targetCenter, entry),
      ],
    };
  });
}

export function straightenComponentStructureEdges(
  graph: ProjectedComponentStructureGraph,
  layout: DiagramLayout,
  direction: ElkCoreDirection,
): DiagramLayout {
  const plane: Plane = planeFor(direction);
  const groupOrigins = resolveGroupOrigins(layout.groups);
  const groupRects = new Map<string, Rect>();
  for (const group of layout.groups) {
    const origin = groupOrigins.get(group.id) ?? { x: 0, y: 0 };
    groupRects.set(group.id, {
      id: group.id,
      min: origin,
      max: { x: origin.x + group.size.width, y: origin.y + group.size.height },
    });
  }

  const nodeParents = new Map(layout.nodes.map(({ id, parentId }) => [id, parentId]));
  const originalRects = toNodeRects(layout.nodes, layout.groups);
  // A mutable copy: nudging shifts obstacle rects as later sightlines are tested.
  const rects = new Map(originalRects);
  const placementById = new Map(layout.edges.map((placement) => [placement.id, placement]));

  const shifted = new Map<string, number>();
  for (const edge of graph.edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) continue;

    // Arms sightline from their port anchor; everything else from the center.
    const start = portAnchorOf(edge, placementById.get(edge.id), rects, originalRects) ?? centerOf(source);
    const targetCenter = centerOf(target);
    for (const [obstacleId, obstacle] of rects) {
      if (obstacleId === edge.source || obstacleId === edge.target) continue;
      const [t0, t1] = clipSegment(start, targetCenter, expanded(obstacle, OBSTACLE_MARGIN)) ?? [-1, -1];
      if (t1 - t0 <= 0.02) continue;

      const obstacleCenter = centerOf(obstacle);
      const rawT =
        (plane.primary(obstacleCenter) - plane.primary(start)) / (plane.primary(targetCenter) - plane.primary(start));
      const t = Number.isFinite(rawT) ? Math.min(1, Math.max(0, rawT)) : 0.5;
      const sightSecondary = plane.secondary(lerp(start, targetCenter, t));
      const half = (plane.secondary(obstacle.max) - plane.secondary(obstacle.min)) / 2;
      const shortfall = half + CLEARANCE - Math.abs(plane.secondary(obstacleCenter) - sightSecondary);
      if (shortfall <= 0) continue;

      const sign = plane.secondary(obstacleCenter) >= sightSecondary ? 1 : -1;
      let delta = sign * shortfall;
      const parent = nodeParents.get(obstacleId);
      const groupRect = parent ? groupRects.get(parent) : undefined;
      if (groupRect) {
        const minCenter = plane.secondary(groupRect.min) + GROUP_CLEARANCE + half;
        const maxCenter = plane.secondary(groupRect.max) - GROUP_CLEARANCE - half;
        if (minCenter > maxCenter) continue;
        delta =
          Math.min(maxCenter, Math.max(minCenter, plane.secondary(obstacleCenter) + delta)) -
          plane.secondary(obstacleCenter);
      }
      if (Math.abs(delta) < 0.5) continue;

      rects.set(obstacleId, shiftRect(obstacle, plane, delta));
      shifted.set(obstacleId, (shifted.get(obstacleId) ?? 0) + delta);
    }
  }

  const nodes = layout.nodes.map<DiagramLayoutNode>((node) => {
    const delta = shifted.get(node.id);
    if (!delta) return node;
    return {
      ...node,
      position: plane.point(plane.primary(node.position), plane.secondary(node.position) + delta),
    };
  });

  return { ...layout, nodes, edges: toStraightEdges(graph, layout, rects, direction) };
}

function toBezierRoutedLayout(layout: DiagramLayout): DiagramLayout {
  return { ...layout, edges: layout.edges.map((edge) => ({ ...edge, routing: "bezier" as const })) };
}

export async function layoutComponentStructureDiagram(
  graph: ProjectedComponentStructureGraph,
  nodeSizes: DiagramNodeSizes,
  options?: ComponentStructureDiagramLayoutConfig["options"],
): Promise<DiagramLayout> {
  const resolved = resolveElkLayeredOptions(options?.elk);
  const decisionIds = new Set(graph.nodes.filter((node) => node.type === "decision").map((node) => node.id));
  const placed = await layoutWithElkCore(
    {
      id: ELK_ROOT_ID,
      layoutOptions: resolved.layoutOptions,
      children: toElkChildrenTree(graph, resolved.direction, (node) => toElkNode(node, nodeSizes, resolved.direction)),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        // A port-bound arm leaves from its decision node's port, not its center;
        // a decision entry arrives at the diamond's upstream vertex port.
        sources: [edge.sourcePort ? elkPortId(edge.source, edge.sourcePort) : edge.source],
        targets: [decisionIds.has(edge.target) ? elkPortId(edge.target, DECISION_ENTRY_PORT) : edge.target],
      })),
    },
    {
      nodeIds: graph.nodes.map(({ id }) => id),
      groupIds: graph.groups.map(({ id }) => id),
      edgeRouting: resolved.edgeRouting,
    },
  );

  const layout: DiagramLayout = {
    ...placed,
    initialView: toElkViewportPolicy(graph.nodes, graph.edges, resolved.direction),
  };
  const reAnchored = reAnchorReverseDecisionEdges(graph, layout, resolved.direction);
  if (options?.nudgeObstacleNodes === true) {
    const straightened = straightenComponentStructureEdges(graph, reAnchored, resolved.direction);
    return options.bezierEdges === true ? toBezierRoutedLayout(straightened) : straightened;
  }
  if (options?.bezierEdges === true) {
    // Border-to-border segments without obstacle nudging; the renderer sways
    // each two-point edge into a natural bezier and smooths any leftover route.
    return toBezierRoutedLayout({
      ...reAnchored,
      edges: toStraightEdges(graph, reAnchored, toNodeRects(reAnchored.nodes, reAnchored.groups), resolved.direction),
    });
  }
  return reAnchored;
}
