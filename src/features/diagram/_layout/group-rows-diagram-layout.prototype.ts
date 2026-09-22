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

type SiblingLayoutItem =
  | Readonly<{
      id: string;
      type: "group";
      layout: LocalGroupLayout;
      size: DiagramLayoutSize;
    }>
  | Readonly<{
      id: string;
      type: "nodes";
      layout: NodeRowsLayout;
      size: DiagramLayoutSize;
    }>;

type SiblingItemsLayout = Readonly<{
  placements: readonly Readonly<{ item: SiblingLayoutItem; position: DiagramLayoutPoint }>[];
  size: DiagramLayoutSize;
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

function findContainingSiblingGroupId(
  groupId: string,
  siblingGroupIds: ReadonlySet<string>,
  groupById: ReadonlyMap<string, DiagramGroup>,
): string | undefined {
  let currentId: string | undefined = groupId;
  while (currentId) {
    if (siblingGroupIds.has(currentId)) return currentId;
    currentId = getOrThrow(groupById.get(currentId), `Missing diagram group: ${currentId}`).parentId;
  }
  return undefined;
}

function assignSiblingItemLayers(
  diagram: DiagramGraph,
  items: readonly SiblingLayoutItem[],
): ReadonlyMap<string, number> {
  const itemIds = items.map(({ id }) => id);
  const groupById = new Map(diagram.groups.map((group) => [group.id, group]));
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const itemIdBySiblingGroupId = new Map(
    items.filter((item) => item.type === "group").map((item) => [item.layout.group.id, item.id]),
  );
  const siblingGroupIds = new Set(itemIdBySiblingGroupId.keys());
  const itemIdByDirectNodeId = new Map(
    items
      .filter((item) => item.type === "nodes")
      .flatMap((item) => item.layout.placements.map(({ node }) => [node.id, item.id] as const)),
  );
  const outgoingByItem = new Map(itemIds.map((itemId) => [itemId, new Set<string>()]));

  function resolveItemId(node: DiagramNode): string | undefined {
    const directNodeItemId = itemIdByDirectNodeId.get(node.id);
    if (directNodeItemId) return directNodeItemId;
    if (!node.groupId) return undefined;
    const siblingGroupId = findContainingSiblingGroupId(node.groupId, siblingGroupIds, groupById);
    return siblingGroupId ? itemIdBySiblingGroupId.get(siblingGroupId) : undefined;
  }

  for (const edge of diagram.edges) {
    const sourceNode = getOrThrow(nodeById.get(edge.source), `Missing edge source node: ${edge.source}`);
    const targetNode = getOrThrow(nodeById.get(edge.target), `Missing edge target node: ${edge.target}`);
    const sourceItemId = resolveItemId(sourceNode);
    const targetItemId = resolveItemId(targetNode);
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) continue;
    getOrThrow(outgoingByItem.get(sourceItemId), `Missing sibling item: ${sourceItemId}`).add(targetItemId);
  }

  const components = findStronglyConnectedComponents(itemIds, outgoingByItem);
  const componentByItem = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((itemId) => componentByItem.set(itemId, componentIndex));
  });

  const outgoingByComponent = components.map(() => new Set<number>());
  const incomingCountByComponent = components.map(() => 0);
  for (const [sourceItemId, targetItemIds] of outgoingByItem) {
    const sourceComponent = getOrThrow(
      componentByItem.get(sourceItemId),
      `Missing dependency component: ${sourceItemId}`,
    );
    for (const targetItemId of targetItemIds) {
      const targetComponent = getOrThrow(
        componentByItem.get(targetItemId),
        `Missing dependency component: ${targetItemId}`,
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
    itemIds.map((itemId) => {
      const component = getOrThrow(componentByItem.get(itemId), `Missing dependency component: ${itemId}`);
      return [itemId, getOrThrow(layerByComponent[component], `Missing dependency layer: ${component}`)];
    }),
  );
}

function layoutSiblingItems(
  groups: readonly LocalGroupLayout[],
  nodes: NodeRowsLayout,
  diagram: DiagramGraph,
  layerGap: number,
): SiblingItemsLayout {
  const items: SiblingLayoutItem[] = [];
  if (nodes.placements.length > 0) {
    items.push({ id: "nodes", type: "nodes", layout: nodes, size: nodes.size });
  }
  groups.forEach((layout, index) => {
    items.push({ id: `group:${index}`, type: "group", layout, size: layout.size });
  });

  const layerByItem = assignSiblingItemLayers(diagram, items);
  const layers = Array.from({
    length: Math.max(...layerByItem.values(), -1) + 1,
  }).map((_, layer) => items.filter(({ id }) => layerByItem.get(id) === layer));
  const layerWidths = layers.map(
    (layerItems) =>
      layerItems.reduce((width, { size }) => width + size.width, 0) +
      Math.max(0, layerItems.length - 1) * GROUP_COLUMN_GAP,
  );
  const width = Math.max(...layerWidths, 0);
  const placements: { item: SiblingLayoutItem; position: DiagramLayoutPoint }[] = [];
  let y = 0;

  layers.forEach((layerItems, layer) => {
    const layerWidth = getOrThrow(layerWidths[layer], `Missing sibling layer width: ${layer}`);
    let x = (width - layerWidth) / 2;
    let layerHeight = 0;

    for (const item of layerItems) {
      placements.push({ item, position: { x, y } });
      layerHeight = Math.max(layerHeight, item.size.height);
      x += item.size.width + GROUP_COLUMN_GAP;
    }

    y += layerHeight;
    if (layer < layers.length - 1) y += layerGap;
  });

  return { placements, size: { width, height: y } };
}

function layoutGroup(group: DiagramGroup, diagram: DiagramGraph, nodeSizes: DiagramNodeSizes): LocalGroupLayout {
  const nodeRows = layoutNodeRows(
    diagram.nodes.filter(({ groupId }) => groupId === group.id),
    nodeSizes,
  );
  const childLayouts = diagram.groups
    .filter(({ parentId }) => parentId === group.id)
    .map((child) => layoutGroup(child, diagram, nodeSizes));
  const content = layoutSiblingItems(childLayouts, nodeRows, diagram, GROUP_ROW_GAP);
  const nodes = content.placements.flatMap(({ item, position }) =>
    item.type === "nodes"
      ? item.layout.placements.map((placement) => ({
          ...placement,
          position: {
            x: GROUP_PADDING.left + position.x + placement.position.x,
            y: GROUP_PADDING.top + position.y + placement.position.y,
          },
        }))
      : [],
  );
  const children = content.placements.flatMap(({ item, position }) =>
    item.type === "group"
      ? [
          {
            layout: item.layout,
            position: {
              x: GROUP_PADDING.left + position.x,
              y: GROUP_PADDING.top + position.y,
            },
          },
        ]
      : [],
  );

  return {
    group,
    nodes,
    children,
    size: {
      width: Math.max(MIN_GROUP_WIDTH, GROUP_PADDING.left + content.size.width + GROUP_PADDING.right),
      height: GROUP_PADDING.top + content.size.height + GROUP_PADDING.bottom,
    },
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
  const rootContent = layoutSiblingItems(rootGroups, ungroupedRows, diagram, GROUP_LAYER_GAP);
  const ungroupedNodes = rootContent.placements.flatMap<DiagramLayoutNode>(({ item, position }) =>
    item.type === "nodes"
      ? item.layout.placements.map((placement) => ({
          id: placement.node.id,
          position: {
            x: position.x + placement.position.x,
            y: position.y + placement.position.y,
          },
          size: placement.size,
        }))
      : [],
  );
  const absoluteNodePositions: Record<string, DiagramLayoutPoint> = Object.fromEntries(
    ungroupedNodes.map(({ id, position }) => [id, position]),
  );
  const materializedGroups = rootContent.placements.flatMap(({ item, position }) => {
    if (item.type !== "group") return [];
    const materialized = materializeGroup(item.layout, position, position);
    Object.assign(absoluteNodePositions, materialized.absoluteNodePositions);
    return [materialized];
  });
  const canvasRight = Math.max(...rootContent.placements.map(({ item, position }) => position.x + item.size.width), 0);

  return Promise.resolve({
    nodes: [...ungroupedNodes, ...materializedGroups.flatMap(({ nodes }) => nodes)],
    groups: materializedGroups.flatMap(({ groups }) => groups),
    edges: layoutEdges(diagram, nodeSizes, absoluteNodePositions, canvasRight),
    initialView: { mode: "fit" },
  });
}
