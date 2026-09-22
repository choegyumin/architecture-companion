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
const GROUP_COLUMN_GAP = 64;
const GROUP_ROW_GAP = 64;
const GROUP_LAYER_GAP = 128;
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

function findStronglyConnectedComponents(
  nodeIds: readonly string[],
  outgoingByNode: ReadonlyMap<string, ReadonlySet<string>>,
): readonly (readonly string[])[] {
  let nextIndex = 0;
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const nodesOnStack = new Set<string>();
  const components: string[][] = [];

  function visit(nodeId: string): void {
    const index = nextIndex++;
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    stack.push(nodeId);
    nodesOnStack.add(nodeId);

    for (const targetId of outgoingByNode.get(nodeId) ?? []) {
      if (!indexByNode.has(targetId)) {
        visit(targetId);
        lowLinkByNode.set(
          nodeId,
          Math.min(
            getOrThrow(lowLinkByNode.get(nodeId), `Missing low-link index: ${nodeId}`),
            getOrThrow(lowLinkByNode.get(targetId), `Missing low-link index: ${targetId}`),
          ),
        );
      } else if (nodesOnStack.has(targetId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(
            getOrThrow(lowLinkByNode.get(nodeId), `Missing low-link index: ${nodeId}`),
            getOrThrow(indexByNode.get(targetId), `Missing dependency index: ${targetId}`),
          ),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const memberId = getOrThrow(stack.pop(), `Missing dependency component member: ${nodeId}`);
      nodesOnStack.delete(memberId);
      component.push(memberId);
      if (memberId === nodeId) break;
    }
    components.push(component);
  }

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) visit(nodeId);
  }

  return components;
}

function getRootGroupId(groupId: string, groupById: ReadonlyMap<string, DiagramGroup>): string {
  let currentId = groupId;
  while (true) {
    const group = getOrThrow(groupById.get(currentId), `Missing diagram group: ${currentId}`);
    if (!group.parentId) return currentId;
    currentId = group.parentId;
  }
}

function assignRootGroupLayers(
  diagram: DiagramGraph,
  rootGroups: readonly LocalGroupLayout[],
): ReadonlyMap<string, number> {
  const rootGroupIds = rootGroups.map(({ group }) => group.id);
  const rootGroupIdSet = new Set(rootGroupIds);
  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const outgoingByGroup = new Map(rootGroupIds.map((groupId) => [groupId, new Set<string>()]));

  for (const edge of diagram.edges) {
    const sourceNode = getOrThrow(nodeById.get(edge.source), `Missing edge source node: ${edge.source}`);
    const targetNode = getOrThrow(nodeById.get(edge.target), `Missing edge target node: ${edge.target}`);
    if (!sourceNode.groupId || !targetNode.groupId) continue;

    const sourceGroupId = getRootGroupId(sourceNode.groupId, groupById);
    const targetGroupId = getRootGroupId(targetNode.groupId, groupById);
    if (sourceGroupId === targetGroupId || !rootGroupIdSet.has(sourceGroupId) || !rootGroupIdSet.has(targetGroupId)) {
      continue;
    }
    getOrThrow(outgoingByGroup.get(sourceGroupId), `Missing root group: ${sourceGroupId}`).add(targetGroupId);
  }

  const components = findStronglyConnectedComponents(rootGroupIds, outgoingByGroup);
  const componentByGroup = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((groupId) => componentByGroup.set(groupId, componentIndex));
  });

  const outgoingByComponent = components.map(() => new Set<number>());
  const incomingCountByComponent = components.map(() => 0);
  for (const [sourceGroupId, targetGroupIds] of outgoingByGroup) {
    const sourceComponent = getOrThrow(
      componentByGroup.get(sourceGroupId),
      `Missing dependency component: ${sourceGroupId}`,
    );
    for (const targetGroupId of targetGroupIds) {
      const targetComponent = getOrThrow(
        componentByGroup.get(targetGroupId),
        `Missing dependency component: ${targetGroupId}`,
      );
      if (sourceComponent === targetComponent || outgoingByComponent[sourceComponent]?.has(targetComponent)) continue;
      getOrThrow(outgoingByComponent[sourceComponent], `Missing dependency component: ${sourceComponent}`).add(
        targetComponent,
      );
      incomingCountByComponent[targetComponent] =
        getOrThrow(incomingCountByComponent[targetComponent], `Missing incoming dependency count: ${targetComponent}`) +
        1;
    }
  }

  const layerByComponent = components.map(() => 0);
  const queue = components
    .map((_, componentIndex) => componentIndex)
    .filter((componentIndex) => incomingCountByComponent[componentIndex] === 0);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const sourceComponent = getOrThrow(queue[queueIndex], `Missing queued dependency component: ${queueIndex}`);
    for (const targetComponent of getOrThrow(
      outgoingByComponent[sourceComponent],
      `Missing dependency component: ${sourceComponent}`,
    )) {
      layerByComponent[targetComponent] = Math.max(
        getOrThrow(layerByComponent[targetComponent], `Missing dependency layer: ${targetComponent}`),
        getOrThrow(layerByComponent[sourceComponent], `Missing dependency layer: ${sourceComponent}`) + 1,
      );
      incomingCountByComponent[targetComponent] =
        getOrThrow(incomingCountByComponent[targetComponent], `Missing incoming dependency count: ${targetComponent}`) -
        1;
      if (incomingCountByComponent[targetComponent] === 0) queue.push(targetComponent);
    }
  }

  return new Map(
    rootGroupIds.map((groupId) => {
      const component = getOrThrow(componentByGroup.get(groupId), `Missing dependency component: ${groupId}`);
      return [groupId, getOrThrow(layerByComponent[component], `Missing dependency layer: ${component}`)];
    }),
  );
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
  const layerByRootGroup = assignRootGroupLayers(diagram, rootGroups);
  const rootGroupLayers = Array.from({
    length: Math.max(...layerByRootGroup.values(), -1) + 1,
  }).map((_, layer) => rootGroups.filter(({ group }) => layerByRootGroup.get(group.id) === layer));
  const layerWidths = rootGroupLayers.map(
    (groups) =>
      groups.reduce((width, { size }) => width + size.width, 0) + Math.max(0, groups.length - 1) * GROUP_COLUMN_GAP,
  );
  const canvasWidth = Math.max(ungroupedRows.size.width, ...layerWidths, 0);

  let y = 0;
  const ungroupedNodes = ungroupedRows.placements.map<DiagramLayoutNode>(({ node, position, size }) => ({
    id: node.id,
    position,
    size,
  }));
  const absoluteNodePositions: Record<string, DiagramLayoutPoint> = Object.fromEntries(
    ungroupedRows.placements.map(({ node, position }) => [node.id, position]),
  );
  if (ungroupedRows.size.height > 0) y += ungroupedRows.size.height + GROUP_LAYER_GAP;

  const materializedGroups: MaterializedLayout[] = [];
  let canvasRight = ungroupedRows.size.width;
  rootGroupLayers.forEach((groups, layer) => {
    const layerWidth = getOrThrow(layerWidths[layer], `Missing group layer width: ${layer}`);
    let x = (canvasWidth - layerWidth) / 2;
    let layerHeight = 0;

    for (const layout of groups) {
      const position = { x, y };
      const materialized = materializeGroup(layout, position, position);
      materializedGroups.push(materialized);
      Object.assign(absoluteNodePositions, materialized.absoluteNodePositions);
      canvasRight = Math.max(canvasRight, x + layout.size.width);
      layerHeight = Math.max(layerHeight, layout.size.height);
      x += layout.size.width + GROUP_COLUMN_GAP;
    }

    y += layerHeight + GROUP_LAYER_GAP;
  });

  return Promise.resolve({
    nodes: [...ungroupedNodes, ...materializedGroups.flatMap(({ nodes }) => nodes)],
    groups: materializedGroups.flatMap(({ groups }) => groups),
    edges: layoutEdges(diagram, nodeSizes, absoluteNodePositions, canvasRight),
    initialView: { mode: "fit" },
  });
}
