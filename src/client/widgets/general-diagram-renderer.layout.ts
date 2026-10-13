import type { GeneralDiagramGraph } from "@/features/diagram/diagram-graph";
import type { GeneralDiagramLayoutConfig } from "@/features/diagram/diagram-layout";
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

// Opt-in straight-line edge routing for layered diagrams: every resolvable edge
// becomes a single source-border to target-border segment, and obstacle nodes
// blocking another edge's sightline are nudged aside along the cross axis to
// clear it. Nudges are clamped inside the node's group, so a node can stay
// blocking when its group offers no room; group frames are not resized. Edges
// that cannot be resolved keep the orthogonal ELK route.
const OBSTACLE_MARGIN = 16;
const CLEARANCE = 40;
const GROUP_CLEARANCE = 16;

function toStraightEdges(
  graph: GeneralDiagramGraph,
  layout: DiagramLayout,
  rects: ReadonlyMap<string, Rect>,
): DiagramLayoutEdge[] {
  return layout.edges.map<DiagramLayoutEdge>((placement) => {
    const edge = graph.edges.find(({ edgeId }) => edgeId === placement.id);
    if (!edge || edge.type === "message") return placement;
    if (
      edge.sourceNodeId === edge.targetNodeId &&
      graph.nodes.some((node) => node.nodeId === edge.sourceNodeId && node.type === "diamond")
    )
      return placement;
    const source = rects.get(edge.sourceNodeId);
    const target = rects.get(edge.targetNodeId);
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
  graph: GeneralDiagramGraph,
  layout: DiagramLayout,
  direction: ReturnType<typeof resolveElkLayeredOptions>["direction"],
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
  // A mutable copy: nudging shifts obstacle rects as later sightlines are tested.
  const rects = new Map(toNodeRects(layout.nodes, layout.groups));

  const shifted = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "message") continue;
    const source = rects.get(edge.sourceNodeId);
    const target = rects.get(edge.targetNodeId);
    if (!source || !target) continue;

    const sourceCenter = centerOf(source);
    const targetCenter = centerOf(target);
    for (const [obstacleId, obstacle] of rects) {
      if (obstacleId === edge.sourceNodeId || obstacleId === edge.targetNodeId) continue;
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

function toBezierRoutedLayout(layout: DiagramLayout): DiagramLayout {
  return { ...layout, edges: layout.edges.map((edge) => ({ ...edge, routing: "bezier" as const })) };
}

function anchorDiamondEdges(graph: GeneralDiagramGraph, layout: DiagramLayout): DiagramLayout {
  const diamondIds = new Set(graph.nodes.filter((node) => node.type === "diamond").map(({ nodeId }) => nodeId));
  if (diamondIds.size === 0) return layout;
  const rects = toNodeRects(layout.nodes, layout.groups);
  const anchor = (nodeId: string, point: DiagramLayoutPoint, toward: DiagramLayoutPoint): DiagramLayoutPoint => {
    if (!diamondIds.has(nodeId)) return point;
    const rect = rects.get(nodeId);
    if (!rect) throw new Error(`Missing diamond placement: ${nodeId}`);
    const center = centerOf(rect);
    // DiamondNode scales its 48-unit viewBox, with tips inset by 2 units.
    const halfWidth = ((rect.max.x - rect.min.x) * 22) / 48;
    const halfHeight = ((rect.max.y - rect.min.y) * 22) / 48;
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    const distance = Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight;
    return distance === 0 ? point : { x: center.x + dx / distance, y: center.y + dy / distance };
  };
  const edgeById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  return {
    ...layout,
    edges: layout.edges.map((placement) => {
      const edge = edgeById.get(placement.id);
      if (!edge || placement.points.length < 2) return placement;
      const points = [...placement.points];
      const first = points.at(0)!;
      const last = points.at(-1)!;
      points[0] = anchor(edge.sourceNodeId, first, points.at(1)!);
      points[points.length - 1] = anchor(edge.targetNodeId, last, placement.points.at(-2)!);
      return { ...placement, points };
    }),
  };
}

export async function layoutGeneralDiagram(
  diagram: GeneralDiagramGraph,
  nodeSizes: DiagramNodeSizes,
  options?: GeneralDiagramLayoutConfig["options"],
): Promise<DiagramLayout> {
  const resolved = resolveElkLayeredOptions(options?.elk);
  const placed = await layoutWithElkCore(
    {
      id: ELK_ROOT_ID,
      layoutOptions: resolved.layoutOptions,
      children: toElkChildrenTree(
        // Stored nodes carry `nodeId`; the ELK tree keys children by a plain `id`.
        { groups: diagram.groups, nodes: diagram.nodes.map((node) => ({ ...node, id: node.nodeId })) },
        resolved.direction,
        (node) => toPlainElkNode(node, nodeSizes),
      ),
      edges: diagram.edges.map((edge) => ({
        id: edge.edgeId,
        sources: [edge.sourceNodeId],
        targets: [edge.targetNodeId],
      })),
    },
    {
      nodeIds: diagram.nodes.map(({ nodeId }) => nodeId),
      groupIds: diagram.groups.map(({ groupId }) => groupId),
      edgeRouting: resolved.edgeRouting,
    },
  );

  const layout: DiagramLayout = {
    ...placed,
    initialView: toElkViewportPolicy(diagram.nodes, diagram.edges, resolved.direction),
  };
  if (options?.nudgeObstacleNodes === true) {
    const straightened = straightenLayeredEdges(diagram, layout, resolved.direction);
    return anchorDiamondEdges(
      diagram,
      options.bezierEdges === true ? toBezierRoutedLayout(straightened) : straightened,
    );
  }
  if (options?.bezierEdges === true) {
    // Border-to-border segments without obstacle nudging; the renderer sways
    // each two-point edge into a natural bezier and smooths any leftover route.
    return anchorDiamondEdges(
      diagram,
      toBezierRoutedLayout({
        ...layout,
        edges: toStraightEdges(diagram, layout, toNodeRects(layout.nodes, layout.groups)),
      }),
    );
  }
  return anchorDiamondEdges(diagram, layout);
}
