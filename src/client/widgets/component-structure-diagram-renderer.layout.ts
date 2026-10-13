import type {
  AuxiliaryDefinition,
  ComponentStructureDiagramNode,
  DiagramControl,
  DiagramGroup,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";
import type { ComponentStructureDiagramLayoutConfig } from "@/features/diagram/diagram-layout";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";
import {
  centerOf,
  clipSegment,
  ELK_ROOT_ID,
  type ElkCoreDirection,
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
} from "@/features/diagram/elk-core";
import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";

/** A branch control projected as its decision node; the node's id is the control's id. */
export type ProjectedDecisionNode = Readonly<{
  type: "decision";
  id: string;
  title: string;
  control: Extract<DiagramControl, { type: "branch" }>;
}>;

/** One dead case rendered as its own node: rendering nothing stays a selectable rendering path. */
export type ProjectedNonComponentNode = Readonly<{
  type: "non-component";
  id: string;
  title: string;
  control: Extract<DiagramControl, { type: "branch" }>;
  caseId: string;
}>;

export type ProjectedComponentStructureNode =
  ComponentStructureDiagramNode | ProjectedDecisionNode | ProjectedNonComponentNode;

/** Stored nodes carry `nodeId`; the projected decision and non-component nodes carry `id`. */
export function projectedComponentStructureNodeId(node: ProjectedComponentStructureNode): string {
  return node.type === "default" ? node.nodeId : node.id;
}

/** One displayed hop: split segments carry the port they leave from and the guards their label renders. */
export type ProjectedComponentStructureEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  guards: DiagramRouteRequirementRuleset;
  activeWhen?: DiagramRouteRequirementRuleset;
}>;

export type ProjectedComponentStructureGraph = Readonly<{
  groups: readonly DiagramGroup[];
  nodes: readonly ProjectedComponentStructureNode[];
  edges: readonly ProjectedComponentStructureEdge[];
  roots: readonly string[];
  controls: readonly DiagramControl[];
  auxiliaryDefinitions: readonly AuxiliaryDefinition[];
}>;

// elkjs resolves edge sources against every node and port id in the graph, so
// port ids must be globally unique: case ids alone collide across decision
// nodes and every arm would bind to whichever node declared that id first.
function elkPortId(nodeId: string, caseId: string): string {
  return `${nodeId}\u0000${caseId}`;
}

// The diamond outline the decision node renders, as [north, east, south, west]
// vertices, matching the polygon in diamond-node.tsx.
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
  const size = toPlainElkNode({ id: projectedComponentStructureNodeId(node) }, nodeSizes);
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
    return { id: elkPortId(node.id, branchCase.caseId), width: 4, height: 4, x: anchor.x - 2, y: anchor.y - 2 };
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
      children: toElkChildrenTree(
        {
          groups: graph.groups,
          // Stored nodes carry `nodeId`; the ELK tree keys children by a plain `id`.
          nodes: graph.nodes.map((node) => ({ ...node, id: projectedComponentStructureNodeId(node) })),
        },
        resolved.direction,
        (node: ProjectedComponentStructureNode) => toElkNode(node, nodeSizes, resolved.direction),
      ),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        // A port-bound arm leaves from its decision node's port, not its center;
        // a decision entry arrives at the diamond's upstream vertex port.
        sources: [edge.sourcePort ? elkPortId(edge.source, edge.sourcePort) : edge.source],
        targets: [decisionIds.has(edge.target) ? elkPortId(edge.target, DECISION_ENTRY_PORT) : edge.target],
      })),
    },
    {
      nodeIds: graph.nodes.map(projectedComponentStructureNodeId),
      groupIds: graph.groups.map(({ groupId }) => groupId),
      edgeRouting: resolved.edgeRouting,
    },
  );

  const layout: DiagramLayout = {
    ...placed,
    initialView: toElkViewportPolicy(
      graph.nodes.map((node) => ({ nodeId: projectedComponentStructureNodeId(node) })),
      graph.edges.map(({ target }) => ({ targetNodeId: target })),
      resolved.direction,
    ),
  };
  const reAnchored = reAnchorReverseDecisionEdges(graph, layout, resolved.direction);
  return straightenComponentStructureEdges(graph, reAnchored, resolved.direction);
}

type Point = Readonly<{ x: number; y: number }>;

const GUARD_LABEL_ENDPOINT_OFFSET = 64;

// Guard edge labels render at text-xs in a max-w-72 button that wraps at a
// fixed width and carries a leading state icon. Sizes are estimated from the
// condition text instead of measured so placement stays a pure layout-time
// decision; the collision margin absorbs the estimation error.
const CHAR_WIDTH = 6;
const ICON_WIDTH = 16;
const BUTTON_CHROME = 18;
const MAX_BUTTON_WIDTH = 288;
const LINE_HEIGHT = 16;
const BUTTON_CHROME_HEIGHT = 10;
const COLLISION_MARGIN = 4;
// Labels pick from discrete slots along their own edge; 4px stays finer
// than the label heights involved while keeping the choice deterministic.
const SLOT_STEP = 4;
const MIN_OFFSET = 8;
// Costs: label overlaps count as their overlap area, node overlaps weigh
// far more (labels must not sit on cards), a mixed pair whose arm label
// ends up below its arrival label breaks the reading order, and the tiny
// drift term prefers the base offset among equally clear slots.
const OBSTACLE_WEIGHT = 100;
const ORDER_WEIGHT = 10;
const DRIFT_WEIGHT = 0.001;
const MAX_PASSES = 8;

export type GuardLabelSize = Readonly<{ width: number; height: number }>;

export function estimateGuardLabelSize(text: string): GuardLabelSize {
  const widest = CHAR_WIDTH * text.length + ICON_WIDTH + BUTTON_CHROME;
  const lines = Math.max(1, Math.ceil(widest / MAX_BUTTON_WIDTH));
  return {
    width: Math.min(MAX_BUTTON_WIDTH, Math.max(widest, ICON_WIDTH + BUTTON_CHROME)),
    height: BUTTON_CHROME_HEIGHT + lines * LINE_HEIGHT,
  };
}

/** One guard edge label anchored `offset` arc length from its edge's `from` end. */
export type GuardLabelGroup = Readonly<{
  edgeId: string;
  from: "start" | "end";
  offset: number;
  points: readonly Point[];
  fallback: Point;
  size: GuardLabelSize;
}>;

export type GuardLabelObstacle = Readonly<{ x: number; y: number; width: number; height: number }>;

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;

const groupKey = (group: GuardLabelGroup): string => `${group.edgeId}\0${group.from}`;

const anchorOf = (group: GuardLabelGroup, offset: number): Point =>
  group.points.length < 2 ? group.fallback : pointAlongPolyline(group.points, offset, group.from);

const boxOf = (group: GuardLabelGroup, offset: number): Box => {
  const anchor = anchorOf(group, offset);
  const halfWidth = group.size.width / 2 + COLLISION_MARGIN;
  const height = group.size.height + COLLISION_MARGIN;
  return {
    left: anchor.x - halfWidth,
    right: anchor.x + halfWidth,
    // Start-anchored labels grow downstream from their anchor while
    // end-anchored labels climb back up the edge, so each box extends one
    // way only.
    top: group.from === "start" ? anchor.y - COLLISION_MARGIN : anchor.y - height,
    bottom: group.from === "start" ? anchor.y + height : anchor.y + COLLISION_MARGIN,
  };
};

const toBox = (obstacle: GuardLabelObstacle): Box => ({
  left: obstacle.x,
  top: obstacle.y,
  right: obstacle.x + obstacle.width,
  bottom: obstacle.y + obstacle.height,
});

const overlapAxis = (aFirst: number, aLast: number, bFirst: number, bLast: number): number =>
  Math.min(aLast, bLast) - Math.max(aFirst, bFirst);

// Offsets a label may take: discrete slots across its whole edge, always
// including its base offset. Degenerate polylines offer only the base.
const slotsOf = (group: GuardLabelGroup): readonly number[] => {
  if (group.points.length < 2) return [group.offset];
  const far = Math.max(group.offset, polylineArcLength(group.points));
  const slots: number[] = [];
  for (let offset = MIN_OFFSET; offset <= far; offset += SLOT_STEP) slots.push(offset);
  if (!slots.includes(group.offset)) slots.push(group.offset);
  return slots;
};

type Placement = Readonly<{ group: GuardLabelGroup; offset: number; anchor: Point; box: Box }>;

const place = (group: GuardLabelGroup, offset: number): Placement => ({
  group,
  offset,
  anchor: anchorOf(group, offset),
  box: boxOf(group, offset),
});

// What one label's placement costs against a fixed world: its overlap area
// with another label (weighted by the mixed-pair order rule), or with a
// node.
const pairCost = (self: Placement, other: Placement): number => {
  const overlapX = overlapAxis(self.box.left, self.box.right, other.box.left, other.box.right);
  const overlapY = overlapAxis(self.box.top, self.box.bottom, other.box.top, other.box.bottom);
  const area = overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
  // A mixed pair defends its reading order only while it reads as one
  // column: same x band and a vertical gap smaller than the pair's own box
  // heights. Crossing within that band costs extra whether or not the boxes
  // still overlap — the order is a placement rule, not an overlap relief,
  // and a pure-intersection gate would let the arm slip tangent-below the
  // arrival for free. Farther apart the labels read independently and pay
  // nothing; the charge formerly applied at any distance, so labels fled
  // far down their edges to escape pairs hundreds of px away.
  if (self.group.from === other.group.from || overlapX <= 0) return area;
  const band = self.box.bottom - self.box.top + (other.box.bottom - other.box.top);
  if (overlapY <= -band) return area;
  const arm = self.group.from === "start" ? self : other;
  const arrival = arm === self ? other : self;
  const inverted = arm.anchor.y - arrival.anchor.y;
  return inverted > 0 ? area + inverted * ORDER_WEIGHT : area;
};

const obstacleCost = (self: Placement, obstacle: Box): number => {
  const overlapX = overlapAxis(self.box.left, self.box.right, obstacle.left, obstacle.right);
  const overlapY = overlapAxis(self.box.top, self.box.bottom, obstacle.top, obstacle.bottom);
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY * OBSTACLE_WEIGHT : 0;
};

/**
 * Places every guard edge label in one global decision. Each label picks
 * from discrete slots along its own edge; a greedy pass repeatedly moves the
 * label with the worst conflict to its cheapest slot (all other labels
 * fixed) until nothing improves. Node boxes never yield, and labels that
 * still overlap at the end are accepted. Returns the chosen offset per
 * group key `${edgeId}\0${from}`.
 */
export function resolveGuardLabelOffsets(
  groups: readonly GuardLabelGroup[],
  obstacles: readonly GuardLabelObstacle[],
): ReadonlyMap<string, number> {
  const placements = groups.map((group) => place(group, group.offset));
  const obstacleBoxes = obstacles.map(toBox);
  const costAgainstWorld = (self: Placement, others: readonly Placement[]): number => {
    let cost = 0;
    for (const other of others) {
      if (other.group.edgeId === self.group.edgeId && other.group.from === self.group.from) continue;
      cost += pairCost(self, other);
    }
    for (const obstacle of obstacleBoxes) cost += obstacleCost(self, obstacle);
    // Prefer the base offset among equally clear slots.
    return cost + Math.abs(self.offset - self.group.offset) * DRIFT_WEIGHT;
  };
  const index = new Map(placements.map((placement) => [groupKey(placement.group), placement]));
  const slotsByGroup = new Map(groups.map((group) => [groupKey(group), slotsOf(group)]));

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const ordered = [...placements].sort((a, b) => {
      const conflictOf = (placement: Placement) =>
        costAgainstWorld(placement, placements) - Math.abs(placement.offset - placement.group.offset) * DRIFT_WEIGHT;
      const difference = conflictOf(b) - conflictOf(a);
      return difference !== 0 ? difference : groupKey(a.group).localeCompare(groupKey(b.group));
    });
    let improved = false;
    for (const current of ordered) {
      const key = groupKey(current.group);
      const slots = slotsByGroup.get(key)!;
      let best = current;
      let bestCost = costAgainstWorld(current, placements);
      for (const offset of slots) {
        if (offset === current.offset) continue;
        const candidate = place(current.group, offset);
        const cost = costAgainstWorld(candidate, placements);
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }
      if (best !== current) {
        index.set(key, best);
        placements.splice(placements.indexOf(current), 1, best);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return new Map([...index].map(([key, placement]) => [key, placement.offset]));
}

export function layoutComponentGuardLabels(
  labels: readonly (Omit<GuardLabelGroup, "offset" | "size"> & Readonly<{ text: string }>)[],
  obstacles: readonly GuardLabelObstacle[],
): ReadonlyMap<string, Point> {
  const groups = labels.map(({ text, ...label }) => ({
    ...label,
    offset: Math.min(GUARD_LABEL_ENDPOINT_OFFSET, polylineArcLength(label.points) / 2),
    size: estimateGuardLabelSize(text),
  }));
  const offsets = resolveGuardLabelOffsets(groups, obstacles);
  return new Map(
    groups.map((group) => [
      group.edgeId,
      group.points.length < 2
        ? (group.points.at(0) ?? group.fallback)
        : pointAlongPolyline(group.points, offsets.get(groupKey(group)) ?? group.offset, group.from),
    ]),
  );
}
