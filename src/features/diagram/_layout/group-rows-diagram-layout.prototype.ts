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

const GROUP_PADDING = { top: 80, right: 64, bottom: 64, left: 64 } as const;
const MIN_GROUP_WIDTH = 352;
const MAX_NODE_ROW_WIDTH = 1_408;
const NODE_COLUMN_GAP = 64;
const NODE_ROW_GAP = 64;
const NODE_LAYER_GAP = 96;
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

function layoutNodeRows(
  nodes: readonly DiagramNode[],
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
): NodeRowsLayout {
  if (nodes.length === 0) return { placements: [], size: { width: 0, height: 0 } };

  const nodeIds = nodes.map(({ id }) => id);
  const nodeIdSet = new Set(nodeIds);
  const nodeIndexById = new Map(nodeIds.map((id, index) => [id, index]));
  const outgoingByNode = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const incomingByNode = new Map(nodeIds.map((id) => [id, new Set<string>()]));

  for (const edge of diagram.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target) || edge.source === edge.target) continue;
    getOrThrow(outgoingByNode.get(edge.source), `Missing node: ${edge.source}`).add(edge.target);
    getOrThrow(incomingByNode.get(edge.target), `Missing node: ${edge.target}`).add(edge.source);
  }

  const components = findStronglyConnectedComponents(nodeIds, outgoingByNode).map((component) =>
    [...component].sort(
      (first, second) =>
        getOrThrow(nodeIndexById.get(first), `Missing node index: ${first}`) -
        getOrThrow(nodeIndexById.get(second), `Missing node index: ${second}`),
    ),
  );
  const componentByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => componentByNode.set(nodeId, componentIndex));
  });

  const outgoingByComponent = components.map(() => new Set<number>());
  const incomingByComponent = components.map(() => new Set<number>());
  for (const [sourceNodeId, targetNodeIds] of outgoingByNode) {
    const sourceComponent = getOrThrow(componentByNode.get(sourceNodeId), `Missing node component: ${sourceNodeId}`);
    for (const targetNodeId of targetNodeIds) {
      const targetComponent = getOrThrow(componentByNode.get(targetNodeId), `Missing node component: ${targetNodeId}`);
      if (sourceComponent === targetComponent) continue;
      getOrThrow(outgoingByComponent[sourceComponent], `Missing outgoing component: ${sourceComponent}`).add(
        targetComponent,
      );
      getOrThrow(incomingByComponent[targetComponent], `Missing incoming component: ${targetComponent}`).add(
        sourceComponent,
      );
    }
  }

  const layerByComponent = components.map(() => 0);
  const incomingCountByComponent = incomingByComponent.map((incoming) => incoming.size);
  const queue = components
    .map((_, componentIndex) => componentIndex)
    .filter((componentIndex) => incomingCountByComponent[componentIndex] === 0);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const sourceComponent = getOrThrow(queue[queueIndex], `Missing node component: ${queueIndex}`);
    for (const targetComponent of getOrThrow(
      outgoingByComponent[sourceComponent],
      `Missing outgoing component: ${sourceComponent}`,
    )) {
      layerByComponent[targetComponent] = Math.max(
        getOrThrow(layerByComponent[targetComponent], `Missing node layer: ${targetComponent}`),
        getOrThrow(layerByComponent[sourceComponent], `Missing node layer: ${sourceComponent}`) + 1,
      );
      incomingCountByComponent[targetComponent] =
        getOrThrow(incomingCountByComponent[targetComponent], `Missing node component count: ${targetComponent}`) - 1;
      if (incomingCountByComponent[targetComponent] === 0) queue.push(targetComponent);
    }
  }

  const declarationOrderByComponent = components.map((component) =>
    Math.min(...component.map((nodeId) => getOrThrow(nodeIndexById.get(nodeId), `Missing node index: ${nodeId}`))),
  );
  const maxLayer = Math.max(...layerByComponent);
  const componentOrderByLayer = Array.from({ length: maxLayer + 1 }, (_, layer) =>
    components
      .map((_, componentIndex) => componentIndex)
      .filter((componentIndex) => layerByComponent[componentIndex] === layer)
      .sort(
        (first, second) =>
          getOrThrow(declarationOrderByComponent[first], `Missing component order: ${first}`) -
          getOrThrow(declarationOrderByComponent[second], `Missing component order: ${second}`),
      ),
  );

  function reorderLayer(layer: number, neighborsByComponent: readonly ReadonlySet<number>[]): void {
    const order = getOrThrow(componentOrderByLayer[layer], `Missing node layer: ${layer}`);
    const neighborPositions = new Map<number, number>();
    const adjacentOrder = componentOrderByLayer[layer + (neighborsByComponent === incomingByComponent ? -1 : 1)];
    adjacentOrder?.forEach((componentIndex, index) => neighborPositions.set(componentIndex, index));
    const currentPosition = new Map(order.map((componentIndex, index) => [componentIndex, index]));

    order.sort((first, second) => {
      const firstNeighbors = [...getOrThrow(neighborsByComponent[first], `Missing node component: ${first}`)].filter(
        (componentIndex) => neighborPositions.has(componentIndex),
      );
      const secondNeighbors = [...getOrThrow(neighborsByComponent[second], `Missing node component: ${second}`)].filter(
        (componentIndex) => neighborPositions.has(componentIndex),
      );
      const firstBarycenter = firstNeighbors.length
        ? firstNeighbors.reduce(
            (sum, componentIndex) =>
              sum + getOrThrow(neighborPositions.get(componentIndex), `Missing neighbor position: ${componentIndex}`),
            0,
          ) / firstNeighbors.length
        : getOrThrow(currentPosition.get(first), `Missing current component position: ${first}`);
      const secondBarycenter = secondNeighbors.length
        ? secondNeighbors.reduce(
            (sum, componentIndex) =>
              sum + getOrThrow(neighborPositions.get(componentIndex), `Missing neighbor position: ${componentIndex}`),
            0,
          ) / secondNeighbors.length
        : getOrThrow(currentPosition.get(second), `Missing current component position: ${second}`);
      return (
        firstBarycenter - secondBarycenter ||
        getOrThrow(declarationOrderByComponent[first], `Missing component order: ${first}`) -
          getOrThrow(declarationOrderByComponent[second], `Missing component order: ${second}`)
      );
    });
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (let layer = 1; layer <= maxLayer; layer += 1) reorderLayer(layer, incomingByComponent);
    for (let layer = maxLayer - 1; layer >= 0; layer -= 1) reorderLayer(layer, outgoingByComponent);
  }

  const componentSizes = components.map((component) => {
    const sizes = component.map((nodeId) => getOrThrow(nodeSizes[nodeId], `Missing measured node size: ${nodeId}`));
    return {
      width: sizes.reduce((width, size) => width + size.width, 0) + Math.max(0, sizes.length - 1) * NODE_COLUMN_GAP,
      height: Math.max(...sizes.map(({ height }) => height)),
    };
  });
  const bandsByLayer = componentOrderByLayer.map((componentOrder) => {
    const bands: { componentIndices: number[]; width: number; height: number }[] = [];
    let current: { componentIndices: number[]; width: number; height: number } | undefined;
    for (const componentIndex of componentOrder) {
      const size = getOrThrow(componentSizes[componentIndex], `Missing component size: ${componentIndex}`);
      const nextWidth = current ? current.width + NODE_COLUMN_GAP + size.width : size.width;
      if (current && nextWidth > MAX_NODE_ROW_WIDTH) {
        bands.push(current);
        current = undefined;
      }
      current ??= { componentIndices: [], width: 0, height: 0 };
      current.componentIndices.push(componentIndex);
      current.width = current.width === 0 ? size.width : current.width + NODE_COLUMN_GAP + size.width;
      current.height = Math.max(current.height, size.height);
    }
    if (current) bands.push(current);
    return bands;
  });

  const componentPositions = new Map<number, DiagramLayoutPoint>();
  const contentWidth = Math.max(...bandsByLayer.flatMap((bands) => bands.map(({ width }) => width)), 0);
  let contentHeight = 0;
  bandsByLayer.forEach((bands) => {
    const layerWidth = Math.max(...bands.map(({ width }) => width), 0);
    let layerY = contentHeight;
    bands.forEach((band, bandIndex) => {
      let x = (contentWidth - layerWidth) / 2 + (layerWidth - band.width) / 2;
      band.componentIndices.forEach((componentIndex) => {
        componentPositions.set(componentIndex, { x, y: layerY });
        x +=
          getOrThrow(componentSizes[componentIndex], `Missing component size: ${componentIndex}`).width +
          NODE_COLUMN_GAP;
      });
      layerY += band.height + (bandIndex < bands.length - 1 ? NODE_ROW_GAP : 0);
    });
    contentHeight = layerY + (bands.length > 0 ? NODE_LAYER_GAP : 0);
  });
  if (contentHeight > 0) contentHeight -= NODE_LAYER_GAP;

  const placements = components.flatMap<NodeRowPlacement>((component, componentIndex) => {
    const position = getOrThrow(
      componentPositions.get(componentIndex),
      `Missing component position: ${componentIndex}`,
    );
    const componentSize = getOrThrow(componentSizes[componentIndex], `Missing component size: ${componentIndex}`);
    let x = position.x;
    return component.map((nodeId) => {
      const node = getOrThrow(
        nodes.find(({ id }) => id === nodeId),
        `Missing layout node: ${nodeId}`,
      );
      const size = getOrThrow(nodeSizes[nodeId], `Missing measured node size: ${nodeId}`);
      const placement = {
        node,
        position: { x, y: position.y + (componentSize.height - size.height) / 2 },
        size,
      };
      x += size.width + NODE_COLUMN_GAP;
      return placement;
    });
  });

  return { placements, size: { width: contentWidth, height: contentHeight } };
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
    diagram,
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
    diagram,
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
