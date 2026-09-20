import z from "zod";

import type { DiagramGraph, DiagramGroup, DiagramNode } from "@/features/diagram/diagram-graph";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutGroup,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramLayoutSize,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export const groupRowsDiagramLayoutConfigSchema = z.object({ id: z.literal("prototype-group-rows") }).strict();

const GROUP_PADDING = { top: 80, right: 32, bottom: 32, left: 32 } as const;
const MIN_GROUP_WIDTH = 352;
const MAX_NODE_ROW_WIDTH = 1_280;
const NODE_COLUMN_GAP = 32;
const NODE_ROW_GAP = 32;
const GROUP_ROW_GAP = 64;
const GROUP_SECTION_GAP = 48;
const EDGE_CORRIDOR_GAP = 96;
const EDGE_LANE_GAP = 10;
const EDGE_LANE_COUNT = 12;

type NodeRowPlacement = Readonly<{
  node: DiagramNode;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
}>;

type NodeRowsLayout = Readonly<{
  placements: readonly NodeRowPlacement[];
  size: DiagramLayoutSize;
}>;

type LocalGroupLayout = Readonly<{
  group: DiagramGroup;
  size: DiagramLayoutSize;
  nodes: readonly NodeRowPlacement[];
  children: readonly Readonly<{ layout: LocalGroupLayout; position: DiagramLayoutPoint }>[];
}>;

type MaterializedLayout = Readonly<{
  groups: readonly DiagramLayoutGroup[];
  nodes: readonly DiagramLayoutNode[];
  absoluteNodePositions: Readonly<Record<string, DiagramLayoutPoint>>;
}>;

function layoutNodeRows(nodes: readonly DiagramNode[], nodeSizes: DiagramNodeSizes): NodeRowsLayout {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;

  const placements = nodes.map<NodeRowPlacement>((node) => {
    const size = getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`);
    if (x > 0 && x + size.width > MAX_NODE_ROW_WIDTH) {
      x = 0;
      y += rowHeight + NODE_ROW_GAP;
      rowHeight = 0;
    }

    const position = { x, y };
    x += size.width + NODE_COLUMN_GAP;
    rowHeight = Math.max(rowHeight, size.height);
    width = Math.max(width, position.x + size.width);

    return { node, position, size };
  });

  return {
    placements,
    size: {
      width,
      height: placements.length === 0 ? 0 : y + rowHeight,
    },
  };
}

function layoutGroup(group: DiagramGroup, diagram: DiagramGraph, nodeSizes: DiagramNodeSizes): LocalGroupLayout {
  const nodeRows = layoutNodeRows(
    diagram.nodes.filter(({ groupId }) => groupId === group.id),
    nodeSizes,
  );
  const childLayouts = diagram.groups
    .filter(({ parentId }) => parentId === group.id)
    .map((child) => layoutGroup(child, diagram, nodeSizes));

  let contentY = GROUP_PADDING.top;
  const nodes = nodeRows.placements.map((placement) => ({
    ...placement,
    position: {
      x: GROUP_PADDING.left + placement.position.x,
      y: contentY + placement.position.y,
    },
  }));
  if (nodeRows.size.height > 0) contentY += nodeRows.size.height;
  if (nodeRows.size.height > 0 && childLayouts.length > 0) contentY += GROUP_SECTION_GAP;

  const children = childLayouts.map((layout) => {
    const position = { x: GROUP_PADDING.left, y: contentY };
    contentY += layout.size.height + GROUP_ROW_GAP;
    return { layout, position };
  });
  if (children.length > 0) contentY -= GROUP_ROW_GAP;

  const contentWidth = Math.max(nodeRows.size.width, ...childLayouts.map(({ size }) => size.width), 0);

  return {
    group,
    nodes,
    children,
    size: {
      width: Math.max(MIN_GROUP_WIDTH, GROUP_PADDING.left + contentWidth + GROUP_PADDING.right),
      height: contentY + GROUP_PADDING.bottom,
    },
  };
}

function materializeGroup(
  layout: LocalGroupLayout,
  position: DiagramLayoutPoint,
  absoluteOrigin: DiagramLayoutPoint,
  parentId?: string,
): MaterializedLayout {
  const groupPlacement = {
    id: layout.group.id,
    ...(parentId ? { parentId } : {}),
    position,
    size: layout.size,
  };
  const nodes = layout.nodes.map<DiagramLayoutNode>(({ node, position: nodePosition, size }) => ({
    id: node.id,
    parentId: layout.group.id,
    position: nodePosition,
    size,
  }));
  const absoluteNodePositions = Object.fromEntries(
    layout.nodes.map(({ node, position: nodePosition }) => [
      node.id,
      { x: absoluteOrigin.x + nodePosition.x, y: absoluteOrigin.y + nodePosition.y },
    ]),
  );
  const descendants = layout.children.map(({ layout: child, position: childPosition }) =>
    materializeGroup(
      child,
      childPosition,
      { x: absoluteOrigin.x + childPosition.x, y: absoluteOrigin.y + childPosition.y },
      layout.group.id,
    ),
  );

  return {
    groups: [groupPlacement, ...descendants.flatMap(({ groups }) => groups)],
    nodes: [...nodes, ...descendants.flatMap(({ nodes }) => nodes)],
    absoluteNodePositions: Object.assign(
      absoluteNodePositions,
      ...descendants.map(({ absoluteNodePositions: childPositions }) => childPositions),
    ),
  };
}

function compactPoints(points: readonly DiagramLayoutPoint[]): readonly DiagramLayoutPoint[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function layoutEdges(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  absoluteNodePositions: Readonly<Record<string, DiagramLayoutPoint>>,
  canvasRight: number,
): readonly DiagramLayoutEdge[] {
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));

  return diagram.edges.map((edge, index) => {
    const sourceNode = getOrThrow(nodeById.get(edge.source), `Missing edge source node: ${edge.source}`);
    const targetNode = getOrThrow(nodeById.get(edge.target), `Missing edge target node: ${edge.target}`);
    const sourcePosition = getOrThrow(absoluteNodePositions[sourceNode.id], `Missing node position: ${sourceNode.id}`);
    const targetPosition = getOrThrow(absoluteNodePositions[targetNode.id], `Missing node position: ${targetNode.id}`);
    const sourceSize = getOrThrow(nodeSizes[sourceNode.id], `Missing measured node size: ${sourceNode.id}`);
    const targetSize = getOrThrow(nodeSizes[targetNode.id], `Missing measured node size: ${targetNode.id}`);
    const source = { x: sourcePosition.x + sourceSize.width, y: sourcePosition.y + sourceSize.height / 2 };
    const target = { x: targetPosition.x, y: targetPosition.y + targetSize.height / 2 };

    if (sourceNode.groupId === targetNode.groupId) {
      const middleX =
        source.x < target.x ? (source.x + target.x) / 2 : Math.max(source.x, target.x) + NODE_COLUMN_GAP / 2;
      return {
        id: edge.id,
        points: compactPoints([source, { x: middleX, y: source.y }, { x: middleX, y: target.y }, target]),
      };
    }

    const corridorX = canvasRight + EDGE_CORRIDOR_GAP + (index % EDGE_LANE_COUNT) * EDGE_LANE_GAP;
    return {
      id: edge.id,
      points: compactPoints([source, { x: corridorX, y: source.y }, { x: corridorX, y: target.y }, target]),
    };
  });
}

export function layoutGroupRowsDiagram(diagram: DiagramGraph, nodeSizes: DiagramNodeSizes): Promise<DiagramLayout> {
  const ungroupedRows = layoutNodeRows(
    diagram.nodes.filter(({ groupId }) => !groupId),
    nodeSizes,
  );
  const rootGroups = diagram.groups
    .filter(({ parentId }) => !parentId)
    .map((group) => layoutGroup(group, diagram, nodeSizes));

  let y = 0;
  const ungroupedNodes = ungroupedRows.placements.map<DiagramLayoutNode>(({ node, position, size }) => ({
    id: node.id,
    position,
    size,
  }));
  const absoluteNodePositions: Record<string, DiagramLayoutPoint> = Object.fromEntries(
    ungroupedRows.placements.map(({ node, position }) => [node.id, position]),
  );
  if (ungroupedRows.size.height > 0) y += ungroupedRows.size.height + GROUP_ROW_GAP;

  const materializedGroups = rootGroups.map((layout) => {
    const position = { x: 0, y };
    const materialized = materializeGroup(layout, position, position);
    y += layout.size.height + GROUP_ROW_GAP;
    Object.assign(absoluteNodePositions, materialized.absoluteNodePositions);
    return materialized;
  });
  const canvasRight = Math.max(ungroupedRows.size.width, ...rootGroups.map(({ size }) => size.width), 0);

  return Promise.resolve({
    nodes: [...ungroupedNodes, ...materializedGroups.flatMap(({ nodes }) => nodes)],
    groups: materializedGroups.flatMap(({ groups }) => groups),
    edges: layoutEdges(diagram, nodeSizes, absoluteNodePositions, canvasRight),
    initialView: { mode: "fit" },
  });
}
