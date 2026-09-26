import z from "zod";

import type { DefaultDiagramNode, DiagramGraph } from "@/features/diagram/diagram-graph";
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

export const dependencyGraphLayoutConfigSchema = z.object({ id: z.literal("dependency-graph") }).strict();

const GROUP_PADDING = { top: 96, right: 80, bottom: 80, left: 80 } as const;
const ROOT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 } as const;
/** Space between sibling nodes in one row / between rows of nodes. */
const NODE_GAP = { horizontal: 64, vertical: 96 } as const;
/** Space between sibling groups in one row / between rows of nested groups. */
const GROUP_GAP = { horizontal: 128, vertical: 128 } as const;
/** Space between top-level groups — the widest corridors aggregate edges route through. */
const ROOT_GAP = { horizontal: 256, vertical: 192 } as const;
const MAX_ROW_WIDTH = 1_408;
const EMPTY_GROUP_SIZE = {
  width: 288 + GROUP_PADDING.left + GROUP_PADDING.right,
  height: GROUP_PADDING.top + GROUP_PADDING.bottom,
} as const;

type Item = Readonly<{
  id: string;
  size: DiagramLayoutSize;
  nodes: readonly DiagramLayoutNode[];
  groups: readonly DiagramLayoutGroup[];
}>;
type Scope = Readonly<{
  size: DiagramLayoutSize;
  nodes: readonly DiagramLayoutNode[];
  groups: readonly DiagramLayoutGroup[];
}>;

function rankComponents(count: number, connections: readonly (readonly [number, number])[]) {
  const outgoing = Array.from({ length: count }, () => new Set<number>());
  const incoming = Array.from({ length: count }, () => new Set<number>());
  connections.forEach(([source, target]) => {
    outgoing[source]?.add(target);
    incoming[target]?.add(source);
  });
  const visited = new Set<number>();
  const finished: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (visited.has(vertex)) continue;
    visited.add(vertex);
    const frames = [{ vertex, neighbors: [...(outgoing[vertex] ?? [])], next: 0 }];
    while (frames.length > 0) {
      const frame = getOrThrow(frames.at(-1), "Missing dependency traversal frame");
      const neighbor = frame.neighbors[frame.next];
      if (neighbor === undefined) {
        finished.push(frame.vertex);
        frames.pop();
      } else {
        frame.next += 1;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        frames.push({ vertex: neighbor, neighbors: [...(outgoing[neighbor] ?? [])], next: 0 });
      }
    }
  }

  const components: number[][] = [];
  const componentOf = Array.from({ length: count }, () => -1);
  for (const vertex of finished.toReversed()) {
    if (componentOf[vertex] !== -1) continue;
    const index = components.length;
    const component: number[] = [];
    const pending = [vertex];
    componentOf[vertex] = index;
    while (pending.length > 0) {
      const member = getOrThrow(pending.pop(), "Missing dependency component member");
      component.push(member);
      incoming[member]?.forEach((neighbor) => {
        if (componentOf[neighbor] !== -1) return;
        componentOf[neighbor] = index;
        pending.push(neighbor);
      });
    }
    components.push(component.toSorted((left, right) => left - right));
  }

  const componentOutgoing = components.map(() => new Set<number>());
  const incomingCounts = components.map(() => 0);
  connections.forEach(([source, target]) => {
    const sourceComponent = componentOf[source];
    const targetComponent = componentOf[target];
    if (sourceComponent === undefined || targetComponent === undefined || sourceComponent === targetComponent) return;
    const targets = getOrThrow(componentOutgoing[sourceComponent], "Missing dependency component");
    if (targets.has(targetComponent)) return;
    targets.add(targetComponent);
    incomingCounts[targetComponent] = getOrThrow(incomingCounts[targetComponent], "Missing incoming count") + 1;
  });
  const ranks = components.map(() => 0);
  const queue = components.flatMap((_, index) => (incomingCounts[index] === 0 ? [index] : []));
  for (let index = 0; index < queue.length; index += 1) {
    const source = getOrThrow(queue[index], "Missing ranked component");
    componentOutgoing[source]?.forEach((target) => {
      ranks[target] = Math.max(
        getOrThrow(ranks[target], "Missing dependency rank"),
        getOrThrow(ranks[source], "Missing source rank") + 1,
      );
      incomingCounts[target] = getOrThrow(incomingCounts[target], "Missing incoming count") - 1;
      if (incomingCounts[target] === 0) queue.push(target);
    });
  }
  return components.map((members, index) => ({ members, rank: getOrThrow(ranks[index], "Missing dependency rank") }));
}

function arrangeItems(
  items: readonly Item[],
  connections: readonly (readonly [number, number])[],
  gap: Readonly<{ horizontal: number; vertical: number }>,
  maxRowWidth = Number.POSITIVE_INFINITY,
): Readonly<{ size: DiagramLayoutSize; positions: readonly DiagramLayoutPoint[] }> {
  const components = rankComponents(items.length, connections);
  const positions: DiagramLayoutPoint[] = Array.from({ length: items.length }, () => ({ x: 0, y: 0 }));
  let cursorY = 0;
  let width = 0;
  const rows: Array<{ indices: number[]; width: number }> = [];
  const byLevel = new Map<number, typeof components>();
  components.forEach((component) => {
    const members = byLevel.get(component.rank) ?? [];
    members.push(component);
    byLevel.set(component.rank, members);
  });
  const levels = [...byLevel.keys()].toSorted((left, right) => left - right);

  levels.forEach((level) => {
    const members = getOrThrow(byLevel.get(level), `Missing dependency level: ${level}`).toSorted(
      (left, right) => (left.members.at(0) ?? 0) - (right.members.at(0) ?? 0),
    );
    let cursorX = 0;
    let bandHeight = 0;
    let rowIndices: number[] = [];
    members.forEach(({ members: component }) => {
      const componentWidth = component.reduce(
        (sum, index) => sum + (items[index]?.size.width ?? 0) + gap.horizontal,
        -gap.horizontal,
      );
      if (cursorX > 0 && cursorX + componentWidth > maxRowWidth) {
        rows.push({ indices: rowIndices, width: cursorX - gap.horizontal });
        width = Math.max(width, cursorX - gap.horizontal);
        cursorX = 0;
        cursorY += bandHeight + gap.horizontal;
        bandHeight = 0;
        rowIndices = [];
      }
      const componentHeight = Math.max(...component.map((index) => items[index]?.size.height ?? 0));
      component.forEach((index) => {
        const item = getOrThrow(items[index], `Missing dependency item: ${index}`);
        positions[index] = { x: cursorX, y: cursorY };
        rowIndices.push(index);
        cursorX += item.size.width + gap.horizontal;
      });
      bandHeight = Math.max(bandHeight, componentHeight);
    });
    rows.push({ indices: rowIndices, width: cursorX - gap.horizontal });
    width = Math.max(width, cursorX - gap.horizontal);
    cursorY += bandHeight + gap.vertical;
  });
  rows.forEach((row) => {
    row.indices.forEach((index) => {
      const position = getOrThrow(positions[index], `Missing dependency position: ${index}`);
      positions[index] = { x: position.x + (width - row.width) / 2, y: position.y };
    });
  });
  return { size: { width, height: levels.length ? cursorY - gap.vertical : 0 }, positions };
}

function layoutDirectNodes(
  nodes: readonly DefaultDiagramNode[],
  nodeSizes: DiagramNodeSizes,
  graph: DiagramGraph,
  directId: string,
): Item {
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  const connections = graph.edges.flatMap((edge): (readonly [number, number])[] => {
    const source = indexes.get(edge.source);
    const target = indexes.get(edge.target);
    return source === undefined || target === undefined ? [] : [[source, target]];
  });
  const items = nodes.map((node) => ({
    id: node.id,
    size: getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
    nodes: [],
    groups: [],
  }));
  const arranged = arrangeItems(items, connections, NODE_GAP, MAX_ROW_WIDTH);
  return {
    id: directId,
    size: arranged.size,
    nodes: nodes.map((node, index) => ({
      id: node.id,
      position: getOrThrow(arranged.positions[index], `Missing dependency node position: ${node.id}`),
      size: getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
    })),
    groups: [],
  };
}

export function layoutDependencyGraph(graph: DiagramGraph, nodeSizes: DiagramNodeSizes): Promise<DiagramLayout> {
  const groupById = new Map(graph.groups.map((group) => [group.id, group]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  let directId = "direct-nodes";
  while (groupById.has(directId)) directId += ":";

  function ownerOf(nodeId: string, parentId: string | undefined): string | undefined {
    const node = nodesById.get(nodeId);
    if (!node) return undefined;
    let groupId = node.groupId;
    if (groupId === parentId) return directId;
    while (groupId) {
      const group = groupById.get(groupId);
      if (!group) return undefined;
      if (group.parentId === parentId) return group.id;
      groupId = group.parentId;
    }
    return undefined;
  }

  function layoutScope(parentId: string | undefined): Scope {
    const padding = parentId ? GROUP_PADDING : ROOT_PADDING;
    const children = graph.groups.filter((group) => group.parentId === parentId);
    const directNodes = graph.nodes.filter(
      (node): node is DefaultDiagramNode => node.groupId === parentId && node.type === "default",
    );
    const items: Item[] = children.map((group) => {
      const contents = layoutScope(group.id);
      return { id: group.id, size: contents.size, nodes: contents.nodes, groups: contents.groups };
    });
    if (directNodes.length > 0) items.push(layoutDirectNodes(directNodes, nodeSizes, graph, directId));
    const indexes = new Map(items.map((item, index) => [item.id, index]));
    const connections = graph.edges.flatMap((edge): (readonly [number, number])[] => {
      const source = indexes.get(ownerOf(edge.source, parentId) ?? "");
      const target = indexes.get(ownerOf(edge.target, parentId) ?? "");
      return source === undefined || target === undefined || source === target ? [] : [[source, target]];
    });
    const arranged = arrangeItems(items, connections, parentId ? GROUP_GAP : ROOT_GAP);
    const groups: DiagramLayoutGroup[] = [];
    const nodes: DiagramLayoutNode[] = [];
    items.forEach((item, index) => {
      const position = getOrThrow(arranged.positions[index], `Missing dependency item position: ${item.id}`);
      const x = position.x + padding.left;
      const y = position.y + padding.top;
      if (item.id !== directId) {
        groups.push({
          id: item.id,
          ...(parentId ? { parentId } : {}),
          position: { x, y },
          size: item.size,
        });
        groups.push(...item.groups);
        nodes.push(...item.nodes);
      } else {
        nodes.push(
          ...item.nodes.map((node) => ({
            ...node,
            ...(parentId ? { parentId } : {}),
            position: { x: x + node.position.x, y: y + node.position.y },
          })),
        );
      }
    });
    return {
      size: {
        width: Math.max(arranged.size.width + padding.left + padding.right, parentId ? EMPTY_GROUP_SIZE.width : 0),
        height: Math.max(arranged.size.height + padding.top + padding.bottom, parentId ? EMPTY_GROUP_SIZE.height : 0),
      },
      groups,
      nodes,
    };
  }

  const scope = layoutScope(undefined);
  const origins = new Map<string, DiagramLayoutPoint>();
  const nodeBounds = new Map<string, Readonly<{ position: DiagramLayoutPoint; size: DiagramLayoutSize }>>();
  const pending = [...scope.groups];
  while (pending.length > 0) {
    const group = getOrThrow(pending.shift(), "Missing dependency group");
    if (group.parentId && !origins.has(group.parentId)) {
      pending.push(group);
      continue;
    }
    const parent = group.parentId
      ? getOrThrow(origins.get(group.parentId), "Missing dependency parent")
      : { x: 0, y: 0 };
    origins.set(group.id, { x: parent.x + group.position.x, y: parent.y + group.position.y });
  }
  scope.nodes.forEach((node) => {
    const parent = node.parentId
      ? getOrThrow(origins.get(node.parentId), "Missing dependency node parent")
      : { x: 0, y: 0 };
    nodeBounds.set(node.id, {
      position: { x: parent.x + node.position.x, y: parent.y + node.position.y },
      size: node.size,
    });
  });

  const edges: DiagramLayoutEdge[] = graph.edges.map((edge) => {
    const source = getOrThrow(nodeBounds.get(edge.source), `Missing dependency source: ${edge.source}`);
    const target = getOrThrow(nodeBounds.get(edge.target), `Missing dependency target: ${edge.target}`);
    const sourceCenter = {
      x: source.position.x + source.size.width / 2,
      y: source.position.y + source.size.height / 2,
    };
    const targetCenter = {
      x: target.position.x + target.size.width / 2,
      y: target.position.y + target.size.height / 2,
    };
    if (edge.source === edge.target) {
      const top = source.position.y;
      const left = sourceCenter.x - source.size.width / 4;
      const right = sourceCenter.x + source.size.width / 4;
      return {
        id: edge.id,
        points: [
          { x: right, y: top },
          { x: right, y: top - 16 },
          { x: left, y: top - 16 },
          { x: left, y: top },
        ],
      };
    }
    const vertical = Math.abs(targetCenter.y - sourceCenter.y) >= Math.abs(targetCenter.x - sourceCenter.x);
    const down = targetCenter.y >= sourceCenter.y;
    const right = targetCenter.x >= sourceCenter.x;
    return {
      id: edge.id,
      points: vertical
        ? [
            { x: sourceCenter.x, y: source.position.y + (down ? source.size.height : 0) },
            { x: targetCenter.x, y: target.position.y + (down ? 0 : target.size.height) },
          ]
        : [
            { x: source.position.x + (right ? source.size.width : 0), y: sourceCenter.y },
            { x: target.position.x + (right ? 0 : target.size.width), y: targetCenter.y },
          ],
    };
  });
  return Promise.resolve({ groups: scope.groups, nodes: scope.nodes, edges, initialView: { mode: "fit" } });
}
