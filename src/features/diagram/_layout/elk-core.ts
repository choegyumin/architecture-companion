import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import z from "zod";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";
import type {
  DiagramLayoutEdge,
  DiagramLayoutGroup,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramViewFramingOptions,
} from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

/*
 * The ELK execution core shared by layered layouts (ADR 0003): option
 * resolution, the ELK run itself, and result extraction. Everything
 * downstream of a raw layout - obstacle nudging, decision anchors, segment
 * geometry - belongs to the individual layout, not here.
 */

const DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"] as const;
const EDGE_ROUTINGS = ["ORTHOGONAL", "POLY_LINE", "SPLINES"] as const;
const NODE_PLACEMENT_STRATEGIES = ["BRANDES_KOEPF", "LINEAR_SEGMENTS", "SIMPLE", "MIN_WIDTH", "INTERACTIVE"] as const;

// Verified options are declared by their ELK id minus the leading "elk.";
// everything else must arrive as a raw `_.`-prefixed full id that is passed
// through verbatim and unverified.
const VERIFIED_ELK_OPTION_KEYS = ["direction", "layered.edgeRouting", "layered.nodePlacement.strategy"] as const;
const DESIGN_OWNED_ELK_OPTION = /^elk\.(padding$|spacing\.|layered\.spacing\.)/;

export const elkOptionMapSchema = z
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

export const ELK_ROOT_ID = "architecture-companion-layout-root";

export const GROUP_PADDING = { top: 96, right: 32, bottom: 32, left: 32 } as const;

// ELK returns 0x0 for children-less groups, and a 0x0 node permanently stalls React Flow's queued fitView.
// Reserve the header chrome plus one default card width (288) so empty groups render and siblings keep clear.
const EMPTY_GROUP_SIZE = {
  width: 288 + GROUP_PADDING.left + GROUP_PADDING.right,
  height: GROUP_PADDING.top + GROUP_PADDING.bottom,
} as const;

type ElkOptionMap = z.infer<typeof elkOptionMapSchema>;
export type ElkCoreDirection = NonNullable<ElkOptionMap["direction"]>;
export type ElkCoreEdgeRouting = NonNullable<ElkOptionMap["layered.edgeRouting"]>;

export type ResolvedElkOptions = Readonly<{
  direction: ElkCoreDirection;
  edgeRouting: ElkCoreEdgeRouting;
  layoutOptions: Record<string, string>;
}>;

function toPadding({ top, right, bottom, left }: typeof GROUP_PADDING): string {
  return `[top=${top},right=${right},bottom=${bottom},left=${left}]`;
}

export function groupLayoutOptions(direction: ElkCoreDirection): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction,
    "elk.padding": toPadding(GROUP_PADDING),
    "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  };
}

// Resolves the elk option map into the root layoutOptions: verified keys keep
// their validated values, `_.` raw keys reassemble into full ELK ids
// ("_.layered.thoroughness" → "elk.layered.thoroughness"), and a raw key that
// targets a verified option is dropped — the verified value wins.
export function resolveElkLayeredOptions(map: ElkOptionMap | undefined): ResolvedElkOptions {
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

/** A plain node's ELK input: id and measured size; ports and layout options are the caller's to add. */
export function toPlainElkNode(
  node: Readonly<{ id: string }>,
  nodeSizes: Readonly<Record<string, { width: number; height: number }>>,
): ElkNode {
  return { id: node.id, ...getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`) };
}

/** Builds the nested ELK children tree for a graph's groups and nodes, using `toElkNode` for each node. */
export function toElkChildrenTree<Node extends Readonly<{ id: string; groupId?: string }>>(
  graph: Readonly<{ groups: DiagramGraph["groups"]; nodes: readonly Node[] }>,
  direction: ElkCoreDirection,
  toElkNode: (node: Node) => ElkNode,
): ElkNode[] {
  const buildGroup = (groupId: string): ElkNode => {
    const children = [
      ...graph.groups.filter(({ parentId }) => parentId === groupId).map(({ id }) => buildGroup(id)),
      ...graph.nodes.filter(({ groupId: nodeGroupId }) => nodeGroupId === groupId).map(toElkNode),
    ];
    return {
      id: groupId,
      ...(children.length === 0 ? EMPTY_GROUP_SIZE : {}),
      layoutOptions: groupLayoutOptions(direction),
      children,
    };
  };
  return [
    ...graph.groups.filter(({ parentId }) => !parentId).map(({ id }) => buildGroup(id)),
    ...graph.nodes.filter(({ groupId }) => !groupId).map(toElkNode),
  ];
}

export async function runElkLayout(input: ElkNode): Promise<ElkNode> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK().layout(input);
}

/** Initial view framing for a layered flow: the single node no edge targets, or a fit. */
export function toElkViewportPolicy(
  nodes: readonly Readonly<{ id: string }>[],
  edges: readonly Readonly<{ target: string }>[],
  direction: ElkCoreDirection,
): DiagramViewFramingOptions {
  const targetIds = new Set(edges.map(({ target }) => target));
  const roots = nodes.filter(({ id }) => !targetIds.has(id));
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
  edgeRouting: ElkCoreEdgeRouting,
): DiagramLayoutEdge {
  const section = edge.sections?.at(0);
  if (!section) throw new Error(`ELK result is missing an edge path: ${edge.id}`);

  const offset = containerId === ELK_ROOT_ID ? { x: 0, y: 0 } : groupOrigins[containerId];
  if (!offset) throw new Error(`ELK result references an unknown edge container: ${containerId}`);

  const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({
    x: x + offset.x,
    y: y + offset.y,
  }));

  // elkjs emits the same polyline skeleton for every edgeRouting value; SPLINES asks
  // the renderer to smooth that skeleton into a spline instead of drawing corners.
  return { id: edge.id, points, ...(edgeRouting === "SPLINES" ? { routing: "spline" as const } : {}) };
}

/**
 * Runs ELK for a fully assembled input and extracts the layout: node and
 * group placements, edge polylines, and the ELK root id the edges were
 * resolved against. Throws when the result drops a node or group.
 */
export async function layoutWithElkCore(
  input: ElkNode,
  expected: Readonly<{ nodeIds: readonly string[]; groupIds: readonly string[]; edgeRouting: ElkCoreEdgeRouting }>,
): Promise<
  Readonly<{
    nodes: readonly DiagramLayoutNode[];
    groups: readonly DiagramLayoutGroup[];
    edges: readonly DiagramLayoutEdge[];
  }>
> {
  const output = await runElkLayout(input);
  const groupIds = new Set(expected.groupIds);
  const elements = collectElements(output, groupIds, undefined, { x: 0, y: 0 });
  const outputNodeIds = new Set(elements.nodes.map(({ id }) => id));
  const outputGroupIds = new Set(elements.groups.map(({ id }) => id));

  expected.nodeIds.forEach((id) => {
    if (!outputNodeIds.has(id)) throw new Error(`ELK result is missing a node: ${id}`);
  });
  expected.groupIds.forEach((id) => {
    if (!outputGroupIds.has(id)) throw new Error(`ELK result is missing a group: ${id}`);
  });

  return {
    nodes: elements.nodes,
    groups: elements.groups,
    edges: collectElkEdges(output).map((edge) =>
      toDiagramLayoutEdge(edge, elements.groupOrigins, expected.edgeRouting),
    ),
  };
}

/* === Geometry primitives ===
 * Direction-aware math shared by layout post-processing. The policies that
 * use them (nudging, anchoring) stay in their own layouts.
 */

export type Rect = Readonly<{ id: string; min: DiagramLayoutPoint; max: DiagramLayoutPoint }>;

// Direction-aware plane: primary = flow axis, secondary = spread axis.
export type Plane = Readonly<{
  primary: (point: DiagramLayoutPoint) => number;
  secondary: (point: DiagramLayoutPoint) => number;
  point: (primary: number, secondary: number) => DiagramLayoutPoint;
}>;

export function planeFor(direction: ElkCoreDirection): Plane {
  return direction === "LEFT" || direction === "RIGHT"
    ? { primary: ({ x }) => x, secondary: ({ y }) => y, point: (x, y) => ({ x, y }) }
    : { primary: ({ y }) => y, secondary: ({ x }) => x, point: (x, y) => ({ x: y, y: x }) };
}

export function centerOf(rect: Rect): DiagramLayoutPoint {
  return { x: (rect.min.x + rect.max.x) / 2, y: (rect.min.y + rect.max.y) / 2 };
}

export function expanded(rect: Rect, margin: number): Rect {
  return {
    id: rect.id,
    min: { x: rect.min.x - margin, y: rect.min.y - margin },
    max: { x: rect.max.x + margin, y: rect.max.y + margin },
  };
}

export function lerp(a: DiagramLayoutPoint, b: DiagramLayoutPoint, t: number): DiagramLayoutPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clipSegment(a: DiagramLayoutPoint, b: DiagramLayoutPoint, rect: Rect): [number, number] | null {
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

export function resolveGroupOrigins(groups: readonly DiagramLayoutGroup[]): Map<string, DiagramLayoutPoint> {
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

export function shiftRect(rect: Rect, plane: Plane, delta: number): Rect {
  const shift = plane.point(0, delta);
  return {
    id: rect.id,
    min: { x: rect.min.x + shift.x, y: rect.min.y + shift.y },
    max: { x: rect.max.x + shift.x, y: rect.max.y + shift.y },
  };
}

export function toNodeRects(
  nodes: readonly DiagramLayoutNode[],
  groups: readonly DiagramLayoutGroup[],
): ReadonlyMap<string, Rect> {
  const groupOrigins = resolveGroupOrigins(groups);
  const rects = new Map<string, Rect>();
  for (const node of nodes) {
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
