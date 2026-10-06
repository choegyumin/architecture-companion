import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import z from "zod";

import type { DiagramEdge, DiagramGraph, DiagramGroup, DiagramNode } from "@/features/diagram/diagram-graph";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutGroup,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramNodeSizes,
  DiagramViewFramingOptions,
} from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

const DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"] as const;
const EDGE_ROUTINGS = ["ORTHOGONAL", "POLY_LINE", "SPLINES"] as const;
const NODE_PLACEMENT_STRATEGIES = ["BRANDES_KOEPF", "LINEAR_SEGMENTS", "SIMPLE", "MIN_WIDTH", "INTERACTIVE"] as const;

// Verified options are declared by their ELK id minus the leading "elk.";
// everything else must arrive as a raw `_.`-prefixed full id that is passed
// through verbatim and unverified.
const VERIFIED_ELK_OPTION_KEYS = ["direction", "layered.edgeRouting", "layered.nodePlacement.strategy"] as const;
const DESIGN_OWNED_ELK_OPTION = /^elk\.(padding$|spacing\.|layered\.spacing\.)/;

const elkOptionMapSchema = z
  .object({
    direction: z.enum(DIRECTIONS).optional(),
    "layered.edgeRouting": z.enum(EDGE_ROUTINGS).optional(),
    "layered.nodePlacement.strategy": z.enum(NODE_PLACEMENT_STRATEGIES).optional(),
  })
  .catchall(z.string())
  .superRefine((options, ctx) => {
    for (const key of Object.keys(options)) {
      if ((VERIFIED_ELK_OPTION_KEYS as readonly string[]).includes(key)) continue;
      if (!key.startsWith("_.")) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Unverified elk options must use the raw `_.` prefix with the full option id.",
        });
        continue;
      }
      if (DESIGN_OWNED_ELK_OPTION.test(`elk.${key.slice(2)}`)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Padding and spacing options are design-owned and cannot be set.",
        });
      }
    }
  });

export const elkLayeredDiagramLayoutConfigSchema = z
  .object({
    id: z.literal("elk-layered"),
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
export type ElkLayeredDiagramLayoutConfig = z.infer<typeof elkLayeredDiagramLayoutConfigSchema>;

const ROOT_ID = "architecture-companion-layout-root";
const GROUP_PADDING = { top: 96, right: 32, bottom: 32, left: 32 } as const;
// ELK returns 0x0 for children-less groups, and a 0x0 node permanently stalls React Flow's queued fitView.
// Reserve the header chrome plus one default card width (288) so empty groups render and siblings keep clear.
const EMPTY_GROUP_SIZE = {
  width: 288 + GROUP_PADDING.left + GROUP_PADDING.right,
  height: GROUP_PADDING.top + GROUP_PADDING.bottom,
} as const;

type ElkLayeredDiagramLayoutElkOptions = NonNullable<NonNullable<ElkLayeredDiagramLayoutConfig["options"]>["elk"]>;
type ElkLayeredDiagramLayoutDirection = NonNullable<ElkLayeredDiagramLayoutElkOptions["direction"]>;
type ElkLayeredDiagramLayoutEdgeRouting = NonNullable<ElkLayeredDiagramLayoutElkOptions["layered.edgeRouting"]>;

function toPadding({ top, right, bottom, left }: typeof GROUP_PADDING): string {
  return `[top=${top},right=${right},bottom=${bottom},left=${left}]`;
}

// Resolves the elk option map into the root layoutOptions: verified keys keep
// their validated values, `_.` raw keys reassemble into full ELK ids
// ("_.layered.thoroughness" → "elk.layered.thoroughness"), and a raw key that
// targets a verified option is dropped — the verified value wins.
function toResolvedElkOptions(map: ElkLayeredDiagramLayoutElkOptions | undefined): Readonly<{
  direction: ElkLayeredDiagramLayoutDirection;
  edgeRouting: ElkLayeredDiagramLayoutEdgeRouting;
  layoutOptions: Record<string, string>;
}> {
  const raw = new Map<string, string>();
  for (const [key, value] of Object.entries(map ?? {})) {
    if (key.startsWith("_.")) raw.set(`elk.${key.slice(2)}`, value);
  }
  const resolve = <T extends string>(verified: T | undefined, id: string, allowed: readonly T[], fallback: T): T => {
    if (verified !== undefined) {
      raw.delete(id);
      return verified;
    }
    const value = raw.get(id);
    raw.delete(id);
    if (value !== undefined && (allowed as readonly string[]).includes(value)) return value as T;
    return fallback;
  };
  const direction = resolve(map?.direction, "elk.direction", DIRECTIONS, "RIGHT");
  const edgeRouting = resolve(map?.["layered.edgeRouting"], "elk.layered.edgeRouting", EDGE_ROUTINGS, "ORTHOGONAL");
  // The default BRANDES_KOEPF aligns the deepest vertical spine to keep it straight,
  // which roots trees at a side edge. LINEAR_SEGMENTS balances layers instead.
  const nodePlacementStrategy = resolve(
    map?.["layered.nodePlacement.strategy"],
    "elk.layered.nodePlacement.strategy",
    NODE_PLACEMENT_STRATEGIES,
    "LINEAR_SEGMENTS",
  );
  return {
    direction,
    edgeRouting,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.edgeRouting": edgeRouting,
      "elk.layered.nodePlacement.strategy": nodePlacementStrategy,
      // hierarchyHandling stays a plain default: SEPARATE_CHILDREN leaves
      // cross-hierarchy edges unrouted, so overriding it is at the author's risk.
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // Design-owned spacing; the schema blocks `_.` overrides for these ids.
      "elk.spacing.nodeNode": "112",
      "elk.layered.spacing.nodeNodeBetweenLayers": "176",
      ...Object.fromEntries(raw),
    },
  };
}

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

function lerp(a: DiagramLayoutPoint, b: DiagramLayoutPoint, t: number): DiagramLayoutPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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

function decisionCorners(rect: Rect, direction: ElkLayeredDiagramLayoutDirection): DecisionCorners {
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

function toElkNode(
  node: DiagramNode,
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  direction: ElkLayeredDiagramLayoutDirection,
): ElkNode {
  const size = getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`);
  const control = diagram.controls?.find(({ id }) => id === node.id);
  if (node.type !== "decision" || control?.kind !== "branch") return { id: node.id, ...size };
  const corners = decisionCorners(
    { id: node.id, min: { x: 0, y: 0 }, max: { x: size.width, y: size.height } },
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
    id: node.id,
    ...size,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports,
  };
}

function toElkGroup(
  group: DiagramGroup,
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  direction: ElkLayeredDiagramLayoutDirection,
): ElkNode {
  const children = [
    ...diagram.groups
      .filter(({ parentId }) => parentId === group.id)
      .map((child) => toElkGroup(child, diagram, nodeSizes, direction)),
    ...diagram.nodes
      .filter(({ groupId }) => groupId === group.id)
      .map((node) => toElkNode(node, diagram, nodeSizes, direction)),
  ];
  return {
    id: group.id,
    ...(children.length === 0 ? EMPTY_GROUP_SIZE : {}),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.padding": toPadding(GROUP_PADDING),
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    },
    children,
  };
}

function toElkInput(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  direction: ElkLayeredDiagramLayoutDirection,
  layoutOptions: Record<string, string>,
): ElkNode {
  const decisionIds = new Set(diagram.nodes.filter((node) => node.type === "decision").map((node) => node.id));
  return {
    id: ROOT_ID,
    layoutOptions,
    children: [
      ...diagram.groups
        .filter(({ parentId }) => !parentId)
        .map((group) => toElkGroup(group, diagram, nodeSizes, direction)),
      ...diagram.nodes.filter(({ groupId }) => !groupId).map((node) => toElkNode(node, diagram, nodeSizes, direction)),
    ],
    edges: diagram.edges.map((edge) => ({
      id: edge.id,
      // A port-bound arm leaves from its decision node's port, not its center;
      // a decision entry arrives at the diamond's upstream vertex port.
      sources: [edge.type === "default" && edge.sourcePort ? elkPortId(edge.source, edge.sourcePort) : edge.source],
      targets: [
        edge.type === "default" && decisionIds.has(edge.target)
          ? elkPortId(edge.target, DECISION_ENTRY_PORT)
          : edge.target,
      ],
    })),
  };
}

type CollectedElements = Readonly<{
  nodes: readonly DiagramLayoutNode[];
  groups: readonly DiagramLayoutGroup[];
  groupOrigins: Readonly<Record<string, DiagramLayoutPoint>>;
}>;

function collectElements(
  parent: ElkNode,
  groupIds: ReadonlySet<string>,
  parentId: string | undefined,
  parentOrigin: DiagramLayoutPoint,
): CollectedElements {
  return (parent.children ?? []).reduce<CollectedElements>(
    (collected, child) => {
      const position = { x: child.x ?? 0, y: child.y ?? 0 };
      const element = {
        id: child.id,
        ...(parentId ? { parentId } : {}),
        position,
        size: { width: child.width ?? 0, height: child.height ?? 0 },
      };

      if (!groupIds.has(child.id)) {
        return { ...collected, nodes: [...collected.nodes, element] };
      }

      const absoluteOrigin = { x: parentOrigin.x + position.x, y: parentOrigin.y + position.y };
      const descendants = collectElements(child, groupIds, child.id, absoluteOrigin);

      return {
        nodes: [...collected.nodes, ...descendants.nodes],
        groups: [...collected.groups, element, ...descendants.groups],
        groupOrigins: {
          ...collected.groupOrigins,
          [child.id]: absoluteOrigin,
          ...descendants.groupOrigins,
        },
      };
    },
    { nodes: [], groups: [], groupOrigins: {} },
  );
}

type CollectedElkEdge = Readonly<{ edge: ElkExtendedEdge; containerId: string }>;

function collectElkEdges(parent: ElkNode): readonly CollectedElkEdge[] {
  return [
    ...(parent.edges ?? []).map((edge) => ({ edge, containerId: edge.container ?? parent.id })),
    ...(parent.children ?? []).flatMap(collectElkEdges),
  ];
}

function toDiagramLayoutEdge(
  { edge, containerId }: CollectedElkEdge,
  groupOrigins: CollectedElements["groupOrigins"],
  edgeRouting: ElkLayeredDiagramLayoutEdgeRouting,
): DiagramLayoutEdge {
  const section = edge.sections?.at(0);
  if (!section) throw new Error(`ELK result is missing an edge path: ${edge.id}`);

  const offset = containerId === ROOT_ID ? { x: 0, y: 0 } : groupOrigins[containerId];
  if (!offset) throw new Error(`ELK result references an unknown edge container: ${containerId}`);

  const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({
    x: x + offset.x,
    y: y + offset.y,
  }));

  // elkjs emits the same polyline skeleton for every edgeRouting value; SPLINES asks
  // the renderer to smooth that skeleton into a spline instead of drawing corners.
  return { id: edge.id, points, ...(edgeRouting === "SPLINES" ? { routing: "spline" as const } : {}) };
}

function toViewportPolicy(
  diagram: DiagramGraph,
  direction: ElkLayeredDiagramLayoutDirection,
): DiagramViewFramingOptions {
  const targetIds = new Set(diagram.edges.map(({ target }) => target));
  const roots = diagram.nodes.filter(({ id }) => !targetIds.has(id));
  const root = roots.length === 1 ? roots.at(0) : undefined;
  if (!root) return { mode: "fit" };

  const isVertical = direction === "UP" || direction === "DOWN";
  return {
    mode: "node",
    nodeId: root.id,
    x: isVertical ? "center" : "clamp",
    y: isVertical ? "clamp" : "center",
  };
}

// Opt-in straight-line edge routing for layered diagrams: every resolvable edge
// becomes a single source-border to target-border segment, and obstacle nodes
// blocking another edge's sightline are nudged aside along the cross axis to
// clear it. Nudges are clamped inside the node's group, so a node can stay
// blocking when its group offers no room; group frames are not resized. Edges
// that cannot be resolved keep the orthogonal ELK route.
const OBSTACLE_MARGIN = 16;
const CLEARANCE = 40;
const GROUP_CLEARANCE = 16;

type Rect = Readonly<{ id: string; min: DiagramLayoutPoint; max: DiagramLayoutPoint }>;

// Direction-aware plane: primary = flow axis, secondary = spread axis.
type Plane = Readonly<{
  primary: (point: DiagramLayoutPoint) => number;
  secondary: (point: DiagramLayoutPoint) => number;
  point: (primary: number, secondary: number) => DiagramLayoutPoint;
}>;

function planeFor(direction: ElkLayeredDiagramLayoutDirection): Plane {
  return direction === "LEFT" || direction === "RIGHT"
    ? { primary: ({ x }) => x, secondary: ({ y }) => y, point: (x, y) => ({ x, y }) }
    : { primary: ({ y }) => y, secondary: ({ x }) => x, point: (x, y) => ({ x: y, y: x }) };
}

function centerOf(rect: Rect): DiagramLayoutPoint {
  return { x: (rect.min.x + rect.max.x) / 2, y: (rect.min.y + rect.max.y) / 2 };
}

function expanded(rect: Rect, margin: number): Rect {
  return {
    id: rect.id,
    min: { x: rect.min.x - margin, y: rect.min.y - margin },
    max: { x: rect.max.x + margin, y: rect.max.y + margin },
  };
}

function clipSegment(a: DiagramLayoutPoint, b: DiagramLayoutPoint, rect: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges = [
    { p: -dx, q: a.x - rect.min.x },
    { p: dx, q: rect.max.x - a.x },
    { p: -dy, q: a.y - rect.min.y },
    { p: dy, q: rect.max.y - a.y },
  ];
  for (const { p, q } of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}

function resolveGroupOrigins(groups: readonly DiagramLayoutGroup[]): Map<string, DiagramLayoutPoint> {
  const origins = new Map<string, DiagramLayoutPoint>();
  const resolve = (group: DiagramLayoutGroup): DiagramLayoutPoint => {
    const known = origins.get(group.id);
    if (known) return known;
    const parent = group.parentId ? groups.find(({ id }) => id === group.parentId) : undefined;
    const parentOrigin = parent ? resolve(parent) : { x: 0, y: 0 };
    const origin = { x: parentOrigin.x + group.position.x, y: parentOrigin.y + group.position.y };
    origins.set(group.id, origin);
    return origin;
  };
  groups.forEach(resolve);
  return origins;
}

function shiftRect(rect: Rect, plane: Plane, delta: number): Rect {
  const shift = plane.point(0, delta);
  return {
    id: rect.id,
    min: { x: rect.min.x + shift.x, y: rect.min.y + shift.y },
    max: { x: rect.max.x + shift.x, y: rect.max.y + shift.y },
  };
}

function toNodeRects(layout: DiagramLayout): ReadonlyMap<string, Rect> {
  const groupOrigins = resolveGroupOrigins(layout.groups);
  const rects = new Map<string, Rect>();
  for (const node of layout.nodes) {
    const parentOrigin = node.parentId ? (groupOrigins.get(node.parentId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const origin = { x: parentOrigin.x + node.position.x, y: parentOrigin.y + node.position.y };
    rects.set(node.id, {
      id: node.id,
      min: origin,
      max: { x: origin.x + node.size.width, y: origin.y + node.size.height },
    });
  }
  return rects;
}

// A decision arm's ELK route starts at its port anchor; nudging may shift the
// decision node afterwards, so the anchor is an offset from the node's original
// top-left corner, rebased onto whatever rect the node holds now.
function portAnchorOf(
  edge: DiagramEdge,
  placement: DiagramLayoutEdge | undefined,
  rects: ReadonlyMap<string, Rect>,
  originalRects: ReadonlyMap<string, Rect>,
): DiagramLayoutPoint | undefined {
  if (!placement || edge.type !== "default" || !edge.sourcePort || placement.points.length === 0) return undefined;
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

// The diamond vertex a `direction` flow enters through: the upstream tip.
function upstreamVertex(rect: Rect, direction: ElkLayeredDiagramLayoutDirection): DiagramLayoutPoint {
  const [north, east, south, west] = diamondVertices(rect);
  return direction === "DOWN" ? north : direction === "UP" ? south : direction === "RIGHT" ? west : east;
}

// Reverse edges — their target sits upstream of their source — leave and
// enter decision diamonds through the slopes instead of the flow vertices, so
// the anchor itself tells a reverse edge apart from forward arms and it never
// slides along the diamond's face. Departures take the upstream slopes of the
// source, arrivals the downstream slopes of the target; each slope spreads
// its edges evenly, on the side that faces the other endpoint.
function reverseDecisionAnchors(
  graph: DiagramGraph,
  rects: ReadonlyMap<string, Rect>,
  direction: ElkLayeredDiagramLayoutDirection,
): Readonly<{ departures: Map<string, DiagramLayoutPoint>; arrivals: Map<string, DiagramLayoutPoint> }> {
  const plane = planeFor(direction);
  const flowSign = direction === "UP" || direction === "LEFT" ? -1 : 1;
  const decisionIds = new Set(graph.nodes.filter((node) => node.type === "decision").map(({ id }) => id));
  const facingSide = (rect: Rect, other: Rect): "A" | "B" =>
    plane.secondary(centerOf(other)) >= plane.secondary(centerOf(rect)) ? "B" : "A";
  const isReverse = (edge: DiagramEdge): boolean => {
    if (edge.type !== "default") return false;
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) return false;
    return (plane.primary(centerOf(target)) - plane.primary(centerOf(source))) * flowSign < -1;
  };

  const departuresBySlope = new Map<string, DiagramEdge[]>();
  const arrivalsBySlope = new Map<string, DiagramEdge[]>();
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
  graph: DiagramGraph,
  layout: DiagramLayout,
  direction: ElkLayeredDiagramLayoutDirection,
): DiagramLayout {
  const anchors = reverseDecisionAnchors(graph, toNodeRects(layout), direction);
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

function toStraightEdges(
  graph: DiagramGraph,
  layout: DiagramLayout,
  rects: ReadonlyMap<string, Rect>,
  direction: ElkLayeredDiagramLayoutDirection,
): DiagramLayoutEdge[] {
  const originalRects = toNodeRects(layout);
  const decisionVertices = new Map(
    graph.nodes
      .filter((node) => node.type === "decision")
      .map((node) => [node.id, upstreamVertex(rects.get(node.id)!, direction)] as const),
  );
  const reverse = reverseDecisionAnchors(graph, rects, direction);
  return layout.edges.map<DiagramLayoutEdge>((placement) => {
    const edge = graph.edges.find(({ id }) => id === placement.id);
    if (!edge || edge.type === "message") return placement;
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

export function straightenLayeredEdges(
  graph: DiagramGraph,
  layout: DiagramLayout,
  direction: ElkLayeredDiagramLayoutDirection,
): DiagramLayout {
  const plane = planeFor(direction);
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
  const originalRects = toNodeRects(layout);
  // A mutable copy: nudging shifts obstacle rects as later sightlines are tested.
  const rects = new Map(originalRects);
  const placementById = new Map(layout.edges.map((placement) => [placement.id, placement]));

  const shifted = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "message") continue;
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

export async function layoutElkLayeredDiagram(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  options?: ElkLayeredDiagramLayoutConfig["options"],
): Promise<DiagramLayout> {
  const resolved = toResolvedElkOptions(options?.elk);
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const output = await new ELK().layout(toElkInput(diagram, nodeSizes, resolved.direction, resolved.layoutOptions));
  const groupIds = new Set(diagram.groups.map(({ id }) => id));
  const elements = collectElements(output, groupIds, undefined, { x: 0, y: 0 });
  const outputNodeIds = new Set(elements.nodes.map(({ id }) => id));
  const outputGroupIds = new Set(elements.groups.map(({ id }) => id));

  diagram.nodes.forEach(({ id }) => {
    if (!outputNodeIds.has(id)) throw new Error(`ELK result is missing a node: ${id}`);
  });
  diagram.groups.forEach(({ id }) => {
    if (!outputGroupIds.has(id)) throw new Error(`ELK result is missing a group: ${id}`);
  });

  const layout: DiagramLayout = {
    nodes: elements.nodes,
    groups: elements.groups,
    edges: collectElkEdges(output).map((edge) =>
      toDiagramLayoutEdge(edge, elements.groupOrigins, resolved.edgeRouting),
    ),
    initialView: toViewportPolicy(diagram, resolved.direction),
  };
  if (options?.nudgeObstacleNodes === true) {
    const straightened = straightenLayeredEdges(diagram, layout, resolved.direction);
    return options.bezierEdges === true ? toBezierRoutedLayout(straightened) : straightened;
  }
  if (options?.bezierEdges === true) {
    // Border-to-border segments without obstacle nudging; the renderer sways
    // each two-point edge into a natural bezier and smooths any leftover route.
    return toBezierRoutedLayout({
      ...layout,
      edges: toStraightEdges(diagram, layout, toNodeRects(layout), resolved.direction),
    });
  }
  return reAnchorReverseDecisionEdges(diagram, layout, resolved.direction);
}
