import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import z from "zod";

import type { DiagramGraph, DiagramGroup } from "@/features/diagram/diagram-graph";
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

export const elkLayeredDiagramLayoutConfigSchema = z
  .object({
    id: z.literal("elk-layered"),
    options: z
      .object({
        direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]).optional(),
        edgeRouting: z.enum(["ORTHOGONAL", "POLY_LINE", "SPLINES"]).optional(),
        nudgeObstacleNodes: z.boolean().optional(),
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

type ElkLayeredDiagramLayoutOptions = NonNullable<ElkLayeredDiagramLayoutConfig["options"]>;
type ElkLayeredDiagramLayoutDirection = NonNullable<ElkLayeredDiagramLayoutOptions["direction"]>;
type ElkLayeredDiagramLayoutEdgeRouting = NonNullable<ElkLayeredDiagramLayoutOptions["edgeRouting"]>;

function toPadding({ top, right, bottom, left }: typeof GROUP_PADDING): string {
  return `[top=${top},right=${right},bottom=${bottom},left=${left}]`;
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
      .map((node) => ({
        id: node.id,
        ...getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
      })),
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
  edgeRouting: ElkLayeredDiagramLayoutEdgeRouting,
): ElkNode {
  return {
    id: ROOT_ID,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.edgeRouting": edgeRouting,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // The default BRANDES_KOEPF aligns the deepest vertical spine to keep it straight,
      // which roots trees at a side edge. LINEAR_SEGMENTS balances layers instead.
      "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS",
      "elk.spacing.nodeNode": "112",
      "elk.layered.spacing.nodeNodeBetweenLayers": "176",
    },
    children: [
      ...diagram.groups
        .filter(({ parentId }) => !parentId)
        .map((group) => toElkGroup(group, diagram, nodeSizes, direction)),
      ...diagram.nodes
        .filter(({ groupId }) => !groupId)
        .map((node) => ({
          id: node.id,
          ...getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
        })),
    ],
    edges: diagram.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
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

function lerp(a: DiagramLayoutPoint, b: DiagramLayoutPoint, t: number): DiagramLayoutPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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

function toStraightEdges(
  graph: DiagramGraph,
  layout: DiagramLayout,
  rects: ReadonlyMap<string, Rect>,
): DiagramLayoutEdge[] {
  return layout.edges.map<DiagramLayoutEdge>((placement) => {
    const edge = graph.edges.find(({ id }) => id === placement.id);
    if (!edge || edge.type === "message") return placement;
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) return placement;

    const sourceCenter = centerOf(source);
    const targetCenter = centerOf(target);
    const [, sourceExit] = clipSegment(sourceCenter, targetCenter, source) ?? [0, 1];
    const [targetEntry] = clipSegment(sourceCenter, targetCenter, target) ?? [1, 0];
    return {
      id: placement.id,
      points: [lerp(sourceCenter, targetCenter, sourceExit ?? 1), lerp(sourceCenter, targetCenter, targetEntry ?? 0)],
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

  const shifted = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "message") continue;
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target) continue;

    const sourceCenter = centerOf(source);
    const targetCenter = centerOf(target);
    for (const [obstacleId, obstacle] of rects) {
      if (obstacleId === edge.source || obstacleId === edge.target) continue;
      const [t0, t1] = clipSegment(sourceCenter, targetCenter, expanded(obstacle, OBSTACLE_MARGIN)) ?? [-1, -1];
      if (t1 - t0 <= 0.02) continue;

      const obstacleCenter = centerOf(obstacle);
      const rawT =
        (plane.primary(obstacleCenter) - plane.primary(sourceCenter)) /
        (plane.primary(targetCenter) - plane.primary(sourceCenter));
      const t = Number.isFinite(rawT) ? Math.min(1, Math.max(0, rawT)) : 0.5;
      const sightSecondary = plane.secondary(lerp(sourceCenter, targetCenter, t));
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

  return { ...layout, nodes, edges: toStraightEdges(graph, layout, rects) };
}

export async function layoutElkLayeredDiagram(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  options?: ElkLayeredDiagramLayoutConfig["options"],
): Promise<DiagramLayout> {
  const direction = options?.direction ?? "DOWN";
  const edgeRouting = options?.edgeRouting ?? "ORTHOGONAL";
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const output = await new ELK().layout(toElkInput(diagram, nodeSizes, direction, edgeRouting));
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
    edges: collectElkEdges(output).map((edge) => toDiagramLayoutEdge(edge, elements.groupOrigins, edgeRouting)),
    initialView: toViewportPolicy(diagram, direction),
  };
  return options?.nudgeObstacleNodes === true ? straightenLayeredEdges(diagram, layout, direction) : layout;
}
