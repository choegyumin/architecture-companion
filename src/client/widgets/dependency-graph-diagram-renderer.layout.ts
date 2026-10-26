import type { DefaultDiagramNode, DependencyDiagramGraph } from "@/features/diagram/diagram-graph";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutGroup,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramLayoutSize,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import { getOrThrow } from "@/shared/universal/get-or-throw";

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
type ScopeInputs = {
  parent?: ScopeInputs;
  depth: number;
  index: number;
  children: DependencyDiagramGraph["groups"][number][];
  nodes: DefaultDiagramNode[];
  connections: (readonly [number, number])[];
  directConnections: (readonly [number, number])[];
};

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
  connections: readonly (readonly [number, number])[],
  directId: string,
): Item {
  const items = nodes.map((node) => ({
    id: node.nodeId,
    size: getOrThrow(nodeSizes[node.nodeId], `Missing measured node size: ${node.nodeId}`),
    nodes: [],
    groups: [],
  }));
  const arranged = arrangeItems(items, connections, NODE_GAP, MAX_ROW_WIDTH);
  return {
    id: directId,
    size: arranged.size,
    nodes: nodes.map((node, index) => ({
      id: node.nodeId,
      position: getOrThrow(arranged.positions[index], `Missing dependency node position: ${node.nodeId}`),
      size: getOrThrow(nodeSizes[node.nodeId], `Missing measured node size: ${node.nodeId}`),
    })),
    groups: [],
  };
}

/**
 * A grounded root shell that holds no files directly and sits alone at the top
 * level carries no structure of its own, so the renderer drops it and promotes
 * its children to the top level, repeating while such a shell remains. A group
 * with direct files, two grounded roots side by side, or a loose top-level node
 * ends the peel. Synthetic groups — generator boundaries synthesized for
 * presentation — never count toward the lone root and never peel; grouping
 * facts below the peeled shells stay untouched. The stored artifact keeps the
 * factual hierarchy — this view only decides what the layout treats as the top
 * level.
 */
export function peelDependencyRootShell(graph: DependencyDiagramGraph): DependencyDiagramGraph {
  let groups = graph.groups;
  let nodes = graph.nodes;
  while (nodes.every(({ groupId }) => groupId)) {
    const groundedRoots = groups.filter(({ parentGroupId, synthetic }) => !parentGroupId && !synthetic);
    if (groundedRoots.length !== 1) break;
    const { groupId: shellId } = getOrThrow(groundedRoots.at(0), "Missing dependency root shell");
    // A root that directly holds files is real content, not a wrapping shell.
    if (nodes.some(({ groupId }) => groupId === shellId)) break;
    groups = groups.flatMap((group) => {
      if (group.groupId === shellId) return [];
      if (group.parentGroupId !== shellId) return [group];
      const { parentGroupId: _peeled, ...promoted } = group;
      return [promoted];
    });
    nodes = nodes.flatMap((node) => {
      if (node.groupId !== shellId) return [node];
      const { groupId: _peeled, ...promoted } = node;
      return [promoted];
    });
  }
  return { ...graph, groups, nodes };
}

export function layoutDependencyGraph(
  graph: DependencyDiagramGraph,
  nodeSizes: DiagramNodeSizes,
): Promise<DiagramLayout> {
  const peeled = peelDependencyRootShell(graph);
  const scopes = new Map<string | undefined, ScopeInputs>(
    [undefined, ...peeled.groups.map((group) => group.groupId)].map((id) => [
      id,
      { depth: 0, index: 0, children: [], nodes: [], connections: [], directConnections: [] },
    ]),
  );
  let directId = "direct-nodes";
  while (scopes.has(directId)) directId += ":";
  peeled.groups.forEach((group) => {
    const scope = getOrThrow(scopes.get(group.groupId), "Missing dependency scope");
    const parent = getOrThrow(scopes.get(group.parentGroupId), "Missing dependency parent scope");
    scope.parent = parent;
    scope.index = parent.children.length;
    parent.children.push(group);
  });
  const pendingScopes = [getOrThrow(scopes.get(undefined), "Missing dependency root scope")];
  for (let index = 0; index < pendingScopes.length; index += 1) {
    const parent = getOrThrow(pendingScopes[index], "Missing dependency scope");
    parent.children.forEach((group) => {
      const scope = getOrThrow(scopes.get(group.groupId), "Missing dependency child scope");
      scope.depth = parent.depth + 1;
      pendingScopes.push(scope);
    });
  }
  const nodesById = new Map<string, { scope: ScopeInputs; index: number }>();
  peeled.nodes.forEach((node) => {
    const scope = getOrThrow(scopes.get(node.groupId), "Missing dependency node scope");
    nodesById.set(node.nodeId, { scope, index: scope.nodes.length });
    scope.nodes.push(node);
  });
  graph.edges.forEach((edge) => {
    const source = getOrThrow(nodesById.get(edge.sourceNodeId), "Missing dependency source node");
    const target = getOrThrow(nodesById.get(edge.targetNodeId), "Missing dependency target node");
    if (source.scope === target.scope) {
      source.scope.directConnections.push([source.index, target.index]);
      return;
    }
    let sourceScope = source.scope;
    let targetScope = target.scope;
    let sourceIndex = sourceScope.children.length;
    let targetIndex = targetScope.children.length;
    // Only the lowest common scope sees different items; higher scopes see one child.
    while (sourceScope.depth > targetScope.depth) {
      sourceIndex = sourceScope.index;
      sourceScope = getOrThrow(sourceScope.parent, "Missing dependency source parent");
    }
    while (targetScope.depth > sourceScope.depth) {
      targetIndex = targetScope.index;
      targetScope = getOrThrow(targetScope.parent, "Missing dependency target parent");
    }
    while (sourceScope !== targetScope) {
      sourceIndex = sourceScope.index;
      sourceScope = getOrThrow(sourceScope.parent, "Missing dependency source parent");
      targetIndex = targetScope.index;
      targetScope = getOrThrow(targetScope.parent, "Missing dependency target parent");
    }
    sourceScope.connections.push([sourceIndex, targetIndex]);
  });

  function layoutScope(parentId: string | undefined): Scope {
    const padding = parentId ? GROUP_PADDING : ROOT_PADDING;
    const {
      children,
      nodes: directNodes,
      connections,
      directConnections,
    } = getOrThrow(scopes.get(parentId), "Missing dependency scope");
    const items: Item[] = children.map((group) => {
      const contents = layoutScope(group.groupId);
      return { id: group.groupId, size: contents.size, nodes: contents.nodes, groups: contents.groups };
    });
    if (directNodes.length > 0) items.push(layoutDirectNodes(directNodes, nodeSizes, directConnections, directId));
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
    const source = getOrThrow(nodeBounds.get(edge.sourceNodeId), `Missing dependency source: ${edge.sourceNodeId}`);
    const target = getOrThrow(nodeBounds.get(edge.targetNodeId), `Missing dependency target: ${edge.targetNodeId}`);
    const sourceCenter = {
      x: source.position.x + source.size.width / 2,
      y: source.position.y + source.size.height / 2,
    };
    const targetCenter = {
      x: target.position.x + target.size.width / 2,
      y: target.position.y + target.size.height / 2,
    };
    if (edge.sourceNodeId === edge.targetNodeId) {
      const top = source.position.y;
      const left = sourceCenter.x - source.size.width / 4;
      const right = sourceCenter.x + source.size.width / 4;
      return {
        id: edge.edgeId,
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
      id: edge.edgeId,
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

export function getDependencyNodeBundleIds(
  groupIds: Iterable<string>,
  reservedIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const used = new Set(reservedIds);
  return new Map(
    [...groupIds].sort().map((groupId) => {
      let id = `bundle:${groupId}`;
      while (used.has(id)) id += ":";
      used.add(id);
      return [groupId, id];
    }),
  );
}

type Point = DiagramLayoutPoint;
type Bounds = Readonly<{ position: Point; size: DiagramLayoutSize }>;
type Rectangle = Readonly<{ left: number; top: number; right: number; bottom: number }>;
type Side = "top" | "right" | "bottom" | "left";
export type DependencyRoutingProjection = Readonly<{ id: string; sourceId: string; targetId: string }>;
type Segment = Readonly<{ from: Point; to: Point; axis: "horizontal" | "vertical" }>;

const EPSILON = 0.001;
const TRACK_GAP = 32;
// A corridor's usable band: route tracks may occupy up to this much of the free
// span, centered; wider corridors keep the leftover empty instead of sprawling.
const TRACK_WIDTH = 256;
// Breathing room kept between a track and the obstacle corner at a corridor's end;
// doubling this to 64 halves the narrowest corridors until their route tracks no
// longer fit, so it stays at the largest value those corridors still tolerate.
const PORTAL_MARGIN = 32;
const MIN_GAP = 4;

function rectangle(bounds: Bounds): Rectangle {
  return {
    left: bounds.position.x,
    top: bounds.position.y,
    right: bounds.position.x + bounds.size.width,
    bottom: bounds.position.y + bounds.size.height,
  };
}

function center(rect: Rectangle): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function portPoint(rect: Rectangle, side: Side, coordinate: number): Point {
  switch (side) {
    case "top":
      return { x: coordinate, y: rect.top };
    case "bottom":
      return { x: coordinate, y: rect.bottom };
    case "left":
      return { x: rect.left, y: coordinate };
    case "right":
      return { x: rect.right, y: coordinate };
  }
}

function portRange(rect: Rectangle, side: Side): readonly [number, number] {
  const vertical = side === "left" || side === "right";
  const from = vertical ? rect.top : rect.left;
  const to = vertical ? rect.bottom : rect.right;
  const padding = Math.min(48, (to - from) / 4);
  return [from + padding, to - padding];
}

function sideFacing(rect: Rectangle, other: Rectangle): Side {
  const a = center(rect);
  const b = center(other);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (
    Math.abs(dx) / Math.max((rect.right - rect.left) / 2, EPSILON) >=
    Math.abs(dy) / Math.max((rect.bottom - rect.top) / 2, EPSILON)
  ) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

function compact(points: readonly Point[]): Point[] {
  const distinct = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  return distinct.filter((point, index) => {
    const previous = index > 0 ? distinct.at(index - 1) : undefined;
    const next = distinct.at(index + 1);
    if (!previous || !next) return true;
    if (previous.x === point.x && point.x === next.x) {
      return (point.y - previous.y) * (next.y - point.y) <= 0;
    }
    if (previous.y === point.y && point.y === next.y) {
      return (point.x - previous.x) * (next.x - point.x) <= 0;
    }
    return true;
  });
}

function routeLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    length += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }
  return length;
}

function midpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((point, index) => {
    const prior = getOrThrow(points[index], "Missing aggregate midpoint point");
    return Math.hypot(point.x - prior.x, point.y - prior.y);
  });
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = getOrThrow(lengths[index], "Missing aggregate segment length");
    if (remaining <= length) {
      const a = getOrThrow(points[index], "Missing aggregate midpoint start");
      const b = getOrThrow(points.at(index + 1), "Missing aggregate midpoint end");
      const fraction = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
    }
    remaining -= length;
  }
  return getOrThrow(points.at(-1), "Missing aggregate midpoint");
}

function crossesObstacle(from: Point, to: Point, rect: Rectangle): boolean {
  if (from.x === to.x && from.y === to.y) return false;
  if (from.y === to.y) {
    return (
      from.y > rect.top + EPSILON &&
      from.y < rect.bottom - EPSILON &&
      Math.min(from.x, to.x) < rect.right - EPSILON &&
      Math.max(from.x, to.x) > rect.left + EPSILON
    );
  }
  return (
    from.x > rect.left + EPSILON &&
    from.x < rect.right - EPSILON &&
    Math.min(from.y, to.y) < rect.bottom - EPSILON &&
    Math.max(from.y, to.y) > rect.top + EPSILON
  );
}

function segments(points: readonly Point[]): Segment[] {
  const result: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    if (from.x === to.x && from.y === to.y) continue;
    result.push({ from, to, axis: from.y === to.y ? "horizontal" : "vertical" });
  }
  return result;
}

function between(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) - EPSILON && value <= Math.max(a, b) + EPSILON;
}

function interaction(first: Segment, second: Segment): Readonly<{ point?: Point; overlap: number; crossing: boolean }> {
  if (first.axis === second.axis) {
    const horizontal = first.axis === "horizontal";
    const fixed = horizontal ? "y" : "x";
    const variable = horizontal ? "x" : "y";
    if (Math.abs(first.from[fixed] - second.from[fixed]) > EPSILON) return { overlap: 0, crossing: false };
    const low = Math.max(
      Math.min(first.from[variable], first.to[variable]),
      Math.min(second.from[variable], second.to[variable]),
    );
    const high = Math.min(
      Math.max(first.from[variable], first.to[variable]),
      Math.max(second.from[variable], second.to[variable]),
    );
    if (high - low > EPSILON) return { overlap: high - low, crossing: false };
    if (low - high > EPSILON) return { overlap: 0, crossing: false };
    return {
      point: horizontal ? { x: low, y: first.from.y } : { x: first.from.x, y: low },
      overlap: 0,
      crossing: false,
    };
  }
  const horizontal = first.axis === "horizontal" ? first : second;
  const vertical = first.axis === "vertical" ? first : second;
  const point = { x: vertical.from.x, y: horizontal.from.y };
  if (!between(point.x, horizontal.from.x, horizontal.to.x) || !between(point.y, vertical.from.y, vertical.to.y))
    return { overlap: 0, crossing: false };
  const crossing =
    point.x > Math.min(horizontal.from.x, horizontal.to.x) + EPSILON &&
    point.x < Math.max(horizontal.from.x, horizontal.to.x) - EPSILON &&
    point.y > Math.min(vertical.from.y, vertical.to.y) + EPSILON &&
    point.y < Math.max(vertical.from.y, vertical.to.y) - EPSILON;
  return { point, overlap: 0, crossing };
}

export function measureAggregateSegmentCongestion(
  candidate: Segment,
  used: readonly Segment[],
): Readonly<{ overlapLength: number; crossings: number }> {
  const intervals: Array<readonly [number, number]> = [];
  const crossings = new Set<string>();
  const variable = candidate.axis === "horizontal" ? "x" : "y";
  for (const prior of used) {
    const relation = interaction(candidate, prior);
    if (relation.overlap > EPSILON) {
      intervals.push([
        Math.max(
          Math.min(candidate.from[variable], candidate.to[variable]),
          Math.min(prior.from[variable], prior.to[variable]),
        ),
        Math.min(
          Math.max(candidate.from[variable], candidate.to[variable]),
          Math.max(prior.from[variable], prior.to[variable]),
        ),
      ]);
    } else if (relation.crossing && relation.point) {
      crossings.add(`${relation.point.x}:${relation.point.y}`);
    }
  }
  intervals.sort((a, b) => a.at(0)! - b.at(0)!);
  let overlapLength = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [from, to] of intervals) {
    overlapLength += Math.max(0, to - Math.max(from, end));
    end = Math.max(end, to);
  }
  return { overlapLength, crossings: crossings.size };
}

class MinHeap<T extends { priority: number; cost: number }> {
  private entries: T[] = [];

  private earlier(a: T, b: T): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.cost < b.cost);
  }

  push(entry: T): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.earlier(entry, this.entries[parent]!)) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): T | undefined {
    const first = this.entries.at(0);
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child =
        right < this.entries.length && this.earlier(this.entries[right]!, this.entries[left]!) ? right : left;
      if (!this.earlier(this.entries[child]!, last)) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

type Cubic = Readonly<{ start: Point; first: Point; second: Point; end: Point }>;
type Metrics = Readonly<{ length: number; intrusion: number; touch: number; deepest: number; overshoot: number }>;
type CurveCandidate = Readonly<{ curve: Cubic; metrics: Metrics; score: number }>;
export type EdgeRoute = Readonly<{ path: string; labelPosition: Point }>;

export function getDependencyElementBounds(layout: DiagramLayout): ReadonlyMap<string, Bounds> {
  const groups = new Map(layout.groups.map((group) => [group.id, group]));
  const origins = new Map<string, Point>();
  const originOf = (groupId: string): Point => {
    const known = origins.get(groupId);
    if (known) return known;
    const group = getOrThrow(groups.get(groupId), `Missing dependency group placement: ${groupId}`);
    const parent = group.parentId ? originOf(group.parentId) : { x: 0, y: 0 };
    const origin = { x: parent.x + group.position.x, y: parent.y + group.position.y };
    origins.set(groupId, origin);
    return origin;
  };
  const entries: Array<readonly [string, Bounds]> = [
    ...layout.groups.map((group): readonly [string, Bounds] => [
      group.id,
      { position: originOf(group.id), size: group.size },
    ]),
    ...layout.nodes.map((node): readonly [string, Bounds] => {
      const parent = node.parentId ? originOf(node.parentId) : { x: 0, y: 0 };
      return [
        node.id,
        {
          position: { x: parent.x + node.position.x, y: parent.y + node.position.y },
          size: node.size,
        },
      ];
    }),
  ];
  return new Map(entries);
}

function clampCurveValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function boundsCenter(bounds: Bounds): Point {
  return { x: bounds.position.x + bounds.size.width / 2, y: bounds.position.y + bounds.size.height / 2 };
}

function anchors(source: Bounds, target: Bounds): Readonly<{ start: Point; end: Point; normal: Point }> {
  const a = boundsCenter(source);
  const b = boundsCenter(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const vertical = Math.abs(dy) >= Math.abs(dx) * 0.85;
  const sign = Math.sign(vertical ? dy : dx) || 1;
  return vertical
    ? {
        start: { x: a.x, y: source.position.y + (sign > 0 ? source.size.height : 0) },
        end: { x: b.x, y: target.position.y + (sign > 0 ? 0 : target.size.height) },
        normal: { x: 0, y: sign },
      }
    : {
        start: { x: source.position.x + (sign > 0 ? source.size.width : 0), y: a.y },
        end: { x: target.position.x + (sign > 0 ? 0 : target.size.width), y: b.y },
        normal: { x: sign, y: 0 },
      };
}

function directCurve(start: Point, end: Point, normal: Point): Cubic {
  const handle = clampCurveValue(distance(start, end) * 0.45, 32, 96);
  return {
    start,
    first: { x: start.x + normal.x * handle, y: start.y + normal.y * handle },
    second: { x: end.x - normal.x * handle, y: end.y - normal.y * handle },
    end,
  };
}

function outwardCurve(
  start: Point,
  end: Point,
  normal: Point,
  offset: number,
  handle: number,
  endOffset = offset,
  endHandle = handle,
): Cubic {
  const length = distance(start, end) || 1;
  const tangent = { x: -normal.y, y: normal.x };
  const side = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const sideAlong = side.x * tangent.x + side.y * tangent.y;
  const sideOut = side.x * normal.x + side.y * normal.y;
  const endOut = (end.x - start.x) * normal.x + (end.y - start.y) * normal.y;
  const endAlong = (end.x - start.x) * tangent.x + (end.y - start.y) * tangent.y;
  const departureAlong = sideAlong * offset;
  const requestedOut = handle + sideOut * offset;
  const departureOut = Math.max(handle, requestedOut, Math.abs(departureAlong));
  const arrivalOut = Math.max(0, endOut - endHandle + sideOut * endOffset - (departureOut - requestedOut));
  const arrivalAlong = endAlong + sideAlong * endOffset;
  return {
    start,
    first: {
      x: start.x + normal.x * departureOut + tangent.x * departureAlong,
      y: start.y + normal.y * departureOut + tangent.y * departureAlong,
    },
    second: {
      x: start.x + normal.x * arrivalOut + tangent.x * arrivalAlong,
      y: start.y + normal.y * arrivalOut + tangent.y * arrivalAlong,
    },
    end,
  };
}

function sampleCurve(curve: Cubic, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * curve.start.x +
      3 * inverse ** 2 * t * curve.first.x +
      3 * inverse * t ** 2 * curve.second.x +
      t ** 3 * curve.end.x,
    y:
      inverse ** 3 * curve.start.y +
      3 * inverse ** 2 * t * curve.first.y +
      3 * inverse * t ** 2 * curve.second.y +
      t ** 3 * curve.end.y,
  };
}

function nearbyCards(curve: Cubic, cards: readonly Bounds[]): Bounds[] {
  const left = Math.min(curve.start.x, curve.first.x, curve.second.x, curve.end.x);
  const right = Math.max(curve.start.x, curve.first.x, curve.second.x, curve.end.x);
  const top = Math.min(curve.start.y, curve.first.y, curve.second.y, curve.end.y);
  const bottom = Math.max(curve.start.y, curve.first.y, curve.second.y, curve.end.y);
  return cards.filter(
    ({ position, size }) =>
      position.x + size.width > left && position.x < right && position.y + size.height > top && position.y < bottom,
  );
}

function measureCurve(curve: Cubic, cards: readonly Bounds[], source: Bounds, target: Bounds): Metrics {
  const nearby = nearbyCards(curve, cards);
  const inside = new Map<Bounds, number>();
  const checkX = Math.abs(curve.end.x - curve.start.x) > (source.size.width + target.size.width) / 4;
  const checkY = Math.abs(curve.end.y - curve.start.y) > ((source.size.height + target.size.height) / 2) * 1.5;
  let length = 0;
  let intrusion = 0;
  let touch = 0;
  let deepest = 0;
  let overshoot = 0;
  let previous = curve.start;
  for (let step = 1; step <= 32; step += 1) {
    const point = sampleCurve(curve, step / 32);
    const stepLength = distance(previous, point);
    length += stepLength;
    if (checkX) {
      overshoot = Math.max(
        overshoot,
        Math.min(curve.start.x, curve.end.x) - point.x,
        point.x - Math.max(curve.start.x, curve.end.x),
      );
    }
    if (checkY) {
      overshoot = Math.max(
        overshoot,
        Math.min(curve.start.y, curve.end.y) - point.y,
        point.y - Math.max(curve.start.y, curve.end.y),
      );
    }
    for (const card of nearby) {
      const { x, y } = card.position;
      const { width, height } = card.size;
      if (point.x > x && point.x < x + width && point.y > y && point.y < y + height) touch += stepLength;
      if (point.x > x + 14 && point.x < x + width - 14 && point.y > y + 12 && point.y < y + height - 12) {
        const total = (inside.get(card) ?? 0) + stepLength;
        inside.set(card, total);
        intrusion += stepLength;
        deepest = Math.max(deepest, total);
      }
    }
    previous = point;
  }
  return { length, intrusion, touch, deepest, overshoot };
}

function centerRisk(curve: Cubic, cards: readonly Bounds[]): ReadonlyMap<Bounds, number> {
  const nearby = nearbyCards(curve, cards);
  const risk = new Map<Bounds, number>();
  if (nearby.length === 0) return risk;
  const controlLength =
    distance(curve.start, curve.first) + distance(curve.first, curve.second) + distance(curve.second, curve.end);
  const steps = clampCurveValue(Math.ceil(controlLength / 5), 64, 256);
  for (let step = 0; step <= steps; step += 1) {
    const point = sampleCurve(curve, step / steps);
    for (const card of nearby) {
      const relativeX = Math.abs(point.x - card.position.x - card.size.width / 2) / (card.size.width / 2 - 14);
      const relativeY = Math.abs(point.y - card.position.y - card.size.height / 2) / (card.size.height / 2 - 12);
      const value = 1 - Math.max(relativeX, relativeY);
      if (value > (risk.get(card) ?? 0)) risk.set(card, value);
    }
  }
  return risk;
}

function centerRegression(result: ReadonlyMap<Bounds, number>, baseline: ReadonlyMap<Bounds, number>): number {
  let regression = 0;
  result.forEach((risk, card) => {
    regression = Math.max(regression, risk - (baseline.get(card) ?? 0));
  });
  return regression;
}

function lateralSeparation(candidate: Cubic, baseline: Cubic): number {
  const dx = baseline.end.x - baseline.start.x;
  const dy = baseline.end.y - baseline.start.y;
  const length = Math.hypot(dx, dy) || 1;
  return [0.25, 0.5, 0.75].reduce((sum, t) => {
    const point = sampleCurve(candidate, t);
    const reference = sampleCurve(baseline, t);
    return sum + Math.abs(dx * (point.y - reference.y) - dy * (point.x - reference.x)) / length / 3;
  }, 0);
}

function blendCurve(baseline: Cubic, selected: Cubic, weight: number): Cubic {
  return {
    start: baseline.start,
    end: baseline.end,
    first: {
      x: baseline.first.x + (selected.first.x - baseline.first.x) * weight,
      y: baseline.first.y + (selected.first.y - baseline.first.y) * weight,
    },
    second: {
      x: baseline.second.x + (selected.second.x - baseline.second.x) * weight,
      y: baseline.second.y + (selected.second.y - baseline.second.y) * weight,
    },
  };
}

function routeScore(metrics: Metrics, offset: number): number {
  return (
    metrics.length +
    metrics.intrusion * 5 +
    metrics.deepest * 0.9 +
    metrics.touch * 2 +
    metrics.overshoot * 4 +
    Math.abs(offset) * 0.23
  );
}

function movesForward(curve: Cubic, normal: Point): boolean {
  const axis = normal.y ? "y" : "x";
  let previous = 0;
  for (const point of [curve.first, curve.second, curve.end]) {
    const progress = (point[axis] - curve.start[axis]) * normal[axis];
    if (progress < previous - 12) return false;
    previous = progress;
  }
  return true;
}

function curveRoute(curve: Cubic): EdgeRoute {
  return {
    path: `M ${curve.start.x} ${curve.start.y} C ${curve.first.x.toFixed(1)} ${curve.first.y.toFixed(1)} ${curve.second.x.toFixed(1)} ${curve.second.y.toFixed(1)} ${curve.end.x.toFixed(1)} ${curve.end.y.toFixed(1)}`,
    labelPosition: sampleCurve(curve, 0.5),
  };
}

export function routeNodeDependencyEdge(source: Bounds, target: Bounds, otherCards: readonly Bounds[]): EdgeRoute {
  const { start, end, normal } = anchors(source, target);
  const baseline = directCurve(start, end, normal);
  const baseMetrics = measureCurve(baseline, otherCards, source, target);
  if (baseMetrics.deepest < 32) return curveRoute(baseline);

  let selected: CurveCandidate = {
    curve: baseline,
    metrics: baseMetrics,
    score: baseMetrics.length + baseMetrics.intrusion * 5 + baseMetrics.deepest * 0.9,
  };
  const candidates: CurveCandidate[] = [];
  const length = distance(start, end);
  const consider = (curve: Cubic, offset: number) => {
    const metrics = measureCurve(curve, otherCards, source, target);
    if (metrics.length > baseMetrics.length * 1.35) return;
    const candidate = { curve, metrics, score: routeScore(metrics, offset) };
    candidates.push(candidate);
    if (candidate.score < selected.score) selected = candidate;
  };
  for (const offset of [0, 75, -75, 150, -150, 240, -240]) {
    if (Math.abs(offset) > Math.min(290, length * 0.28)) continue;
    for (const scale of [0.28, 0.44]) {
      consider(outwardCurve(start, end, normal, offset, clampCurveValue(length * scale, 52, 190)), offset);
    }
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (
    normal.x &&
    Math.abs(dx) > (source.size.width + target.size.width) / 4 &&
    Math.abs(dy) > ((source.size.height + target.size.height) / 2) * 1.5
  ) {
    const direction = Math.sign(dx) * Math.sign(dy);
    for (const first of [160, 200, 240, 320]) {
      if (first > Math.min(330, length * 0.38)) continue;
      for (const last of [80, 160, 200, 240]) {
        for (const handle of [80, 110, 140]) {
          const curve = outwardCurve(start, end, normal, direction * first, handle, -direction * last, 120);
          if (movesForward(curve, normal)) consider(curve, Math.max(first, last));
        }
      }
    }
  }
  if (selected.curve === baseline) return curveRoute(baseline);

  const baselineRisk = centerRisk(baseline, otherCards);
  if (centerRegression(centerRisk(selected.curve, otherCards), baselineRisk) <= 0.25) {
    return curveRoute(selected.curve);
  }
  const requiredSeparation = Math.max(8, lateralSeparation(selected.curve, baseline) * 0.35);
  const maxScore = selected.score + Math.max(150, baseMetrics.length * 0.12);
  const acceptable = (candidate: CurveCandidate): boolean =>
    centerRegression(centerRisk(candidate.curve, otherCards), baselineRisk) <= 0.25 &&
    lateralSeparation(candidate.curve, baseline) >= requiredSeparation &&
    candidate.metrics.length <= baseMetrics.length * 1.35 &&
    candidate.score <= maxScore;
  const existing = candidates
    .filter(acceptable)
    .sort((a, b) => a.score - b.score)
    .at(0);
  if (existing) return curveRoute(existing.curve);

  let intermediate: CurveCandidate | undefined;
  for (const weight of [0.35, 0.5, 0.65]) {
    const curve = blendCurve(baseline, selected.curve, weight);
    const metrics = measureCurve(curve, otherCards, source, target);
    const candidate = { curve, metrics, score: routeScore(metrics, 0) };
    if (acceptable(candidate) && (!intermediate || candidate.score < intermediate.score)) intermediate = candidate;
  }
  return curveRoute(intermediate?.curve ?? selected.curve);
}

export function routeOriginalDependencyEdge(
  points: readonly Point[],
  source: Bounds,
  target: Bounds,
  otherCards: readonly Bounds[],
): EdgeRoute {
  if (points.length < 2) throw new Error("Dependency edge is missing endpoints.");
  if (points.length !== 2) {
    if (source.position.x === target.position.x && source.position.y === target.position.y) {
      const start = getOrThrow(points.at(0), "Missing self-loop start");
      const end = getOrThrow(points.at(-1), "Missing self-loop end");
      const along = Math.min(source.size.width / 6, 48);
      const outward = Math.max(40, along);
      return curveRoute({
        start,
        first: { x: start.x + along, y: start.y - outward },
        second: { x: end.x - along, y: end.y - outward },
        end,
      });
    }
    return {
      path: points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
      labelPosition: getPolylineEdgeLabelPlacement(points),
    };
  }
  return routeNodeDependencyEdge(source, target, otherCards);
}

type RoutingObstacle = Readonly<{
  id: string;
  kind: "group" | "node" | "virtual";
  rect: Rectangle;
  parentId?: string;
  members?: readonly string[];
}>;
type RoutingCell = Readonly<{
  id: number;
  rect: Rectangle;
  blockers: readonly string[];
  portals: readonly number[];
}>;
type RoutingPortal = Readonly<{
  id: number;
  a: number;
  b: number;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
}>;
type RoutingScene = Readonly<{
  bounds: ReadonlyMap<string, Bounds>;
  obstacles: readonly RoutingObstacle[];
  cells: readonly RoutingCell[];
  portals: readonly RoutingPortal[];
  parents: ReadonlyMap<string, string | undefined>;
  kinds: ReadonlyMap<string, "group" | "node">;
  bundles: ReadonlyMap<string, RoutingObstacle>;
}>;
type RoutingTerminal = Readonly<{
  key: string;
  elementId: string;
  side: Side;
  cell: number;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
  inward: boolean;
}>;

const MAX_OBSTACLES = 2_000;
const MAX_SLABS = 4_000;
const MAX_CELLS = 20_000;
const MAX_PORTALS = 60_000;
const MAX_SCENE_WORK = 2_000_000;
// Breathing room between a loose-node bundle and the cards it wraps.
const BUNDLE_PADDING = 32;

function valid(rect: Rectangle): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.left < rect.right &&
    rect.top < rect.bottom
  );
}

function virtualObstacles(
  layout: DiagramLayout,
  bounds: ReadonlyMap<string, Bounds>,
  existing: ReadonlySet<string>,
): RoutingObstacle[] | undefined {
  const children = new Map<string | undefined, string[]>();
  for (const node of layout.nodes) {
    const members = children.get(node.parentId) ?? [];
    members.push(node.id);
    children.set(node.parentId, members);
  }
  const identifiers = getDependencyNodeBundleIds(
    layout.groups.map(({ id }) => id),
    existing,
  );
  const result: RoutingObstacle[] = [];
  for (const [parentId, members] of children) {
    // Virtual wrappers exist only where loose nodes sit beside subgroups: a pure
    // node container duplicates its group obstacle, and top-level nodes are already
    // laid out together — wrapping them only blocks unrelated through traffic.
    if (!parentId || !layout.groups.some((group) => group.parentId === parentId)) continue;
    members.sort();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const member of members) {
      const placement = bounds.get(member);
      if (!placement) return undefined;
      const rect = rectangle(placement);
      if (!valid(rect)) return undefined;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
    const id = identifiers.get(parentId)!;
    // Padding keeps the drawn outline and the routing face off the cards, so the
    // bundle reads as a container instead of a second skin. It draws into the
    // group's free space — the layout does not reserve room for it.
    result.push({
      id,
      kind: "virtual",
      rect: {
        left: left - BUNDLE_PADDING,
        top: top - BUNDLE_PADDING,
        right: right + BUNDLE_PADDING,
        bottom: bottom + BUNDLE_PADDING,
      },
      parentId,
      members,
    });
  }
  return result;
}

export function collectVirtualBundles(
  layout: DiagramLayout,
  bounds: ReadonlyMap<string, Bounds>,
): ReadonlyMap<string, Bounds & Readonly<{ id: string }>> | undefined {
  const existing = new Set([...layout.groups, ...layout.nodes, ...layout.edges].map(({ id }) => id));
  const virtual = virtualObstacles(layout, bounds, existing);
  if (!virtual) return undefined;
  const bundles = new Map<string, Bounds & Readonly<{ id: string }>>();
  for (const obstacle of virtual) {
    if (!obstacle.parentId) continue;
    bundles.set(obstacle.parentId, {
      id: obstacle.id,
      position: { x: obstacle.rect.left, y: obstacle.rect.top },
      size: {
        width: obstacle.rect.right - obstacle.rect.left,
        height: obstacle.rect.bottom - obstacle.rect.top,
      },
    });
  }
  return bundles;
}

function buildRoutingScene(layout: DiagramLayout, bounds: ReadonlyMap<string, Bounds>): RoutingScene | undefined {
  const parents = new Map<string, string | undefined>();
  const kinds = new Map<string, "group" | "node">();
  const obstacles: RoutingObstacle[] = [];
  for (const group of layout.groups) {
    const placement = bounds.get(group.id);
    if (!placement) return undefined;
    const rect = rectangle(placement);
    if (!valid(rect)) return undefined;
    obstacles.push({ id: group.id, kind: "group", rect, parentId: group.parentId });
    parents.set(group.id, group.parentId);
    kinds.set(group.id, "group");
  }
  for (const node of layout.nodes) {
    const placement = bounds.get(node.id);
    if (!placement) return undefined;
    const rect = rectangle(placement);
    if (!valid(rect)) return undefined;
    obstacles.push({ id: node.id, kind: "node", rect, parentId: node.parentId });
    parents.set(node.id, node.parentId);
    kinds.set(node.id, "node");
  }
  const virtual = virtualObstacles(layout, bounds, new Set([...obstacles, ...layout.edges].map(({ id }) => id)));
  if (!virtual) return undefined;
  obstacles.push(...virtual);
  // Bundles behave like groups downstream: ancestors resolve through the parent
  // chain, so existing exemptions apply unchanged.
  const bundles = new Map<string, RoutingObstacle>();
  const sceneBounds = new Map(bounds);
  for (const obstacle of virtual) {
    if (!obstacle.parentId) continue;
    bundles.set(obstacle.parentId, obstacle);
    parents.set(obstacle.id, obstacle.parentId);
    kinds.set(obstacle.id, "group");
    sceneBounds.set(obstacle.id, {
      position: { x: obstacle.rect.left, y: obstacle.rect.top },
      size: {
        width: obstacle.rect.right - obstacle.rect.left,
        height: obstacle.rect.bottom - obstacle.rect.top,
      },
    });
  }
  if (obstacles.length === 0 || obstacles.length > MAX_OBSTACLES) return undefined;
  obstacles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const left = Math.min(...obstacles.map(({ rect }) => rect.left));
  const top = Math.min(...obstacles.map(({ rect }) => rect.top));
  const right = Math.max(...obstacles.map(({ rect }) => rect.right));
  const bottom = Math.max(...obstacles.map(({ rect }) => rect.bottom));
  const margin = Math.max(512, Math.max(right - left, bottom - top) / 8);
  const world = { left: left - margin, top: top - margin, right: right + margin, bottom: bottom + margin };
  if (!valid(world)) return undefined;
  const xs = [...new Set([world.left, world.right, ...obstacles.flatMap(({ rect }) => [rect.left, rect.right])])].sort(
    (a, b) => a - b,
  );
  if (xs.length - 1 > MAX_SLABS) return undefined;

  const cells: Array<{
    id: number;
    rect: Rectangle;
    blockers: readonly string[];
    portals: number[];
  }> = [];
  const portals: RoutingPortal[] = [];
  let work = obstacles.length + xs.length;
  let previousSlab: number[] = [];
  const connect = (a: number, b: number, axis: "x" | "y", fixed: number, min: number, max: number): boolean => {
    if (max - min <= EPSILON) return true;
    if (portals.length >= MAX_PORTALS || ++work > MAX_SCENE_WORK) return false;
    const id = portals.length;
    portals.push({ id, a, b, axis, fixed, min, max });
    cells[a]!.portals.push(id);
    cells[b]!.portals.push(id);
    return true;
  };

  for (let slab = 0; slab < xs.length - 1; slab += 1) {
    const x0 = xs.at(slab)!;
    const x1 = xs.at(slab + 1)!;
    work += obstacles.length;
    if (work > MAX_SCENE_WORK) return undefined;
    const active = obstacles.filter(({ rect }) => rect.left < x1 && rect.right > x0);
    const events = new Map<number, { enter: string[]; leave: string[] }>();
    const eventAt = (y: number) => {
      let event = events.get(y);
      if (!event) {
        event = { enter: [], leave: [] };
        events.set(y, event);
      }
      return event;
    };
    for (const obstacle of active) {
      eventAt(obstacle.rect.top).enter.push(obstacle.id);
      eventAt(obstacle.rect.bottom).leave.push(obstacle.id);
    }
    const ys = [...new Set([world.top, world.bottom, ...events.keys()])].sort((a, b) => a - b);
    work += active.length * 2 + ys.length;
    if (work > MAX_SCENE_WORK || cells.length + ys.length - 1 > MAX_CELLS) return undefined;
    const mask = new Set<string>();
    const currentSlab: number[] = [];
    for (let row = 0; row < ys.length - 1; row += 1) {
      const y0 = ys.at(row)!;
      const y1 = ys.at(row + 1)!;
      const event = events.get(y0);
      for (const id of event?.leave ?? []) mask.delete(id);
      for (const id of event?.enter ?? []) mask.add(id);
      work += mask.size + 1;
      if (work > MAX_SCENE_WORK || cells.length >= MAX_CELLS) return undefined;
      const id = cells.length;
      cells.push({
        id,
        rect: { left: x0, right: x1, top: y0, bottom: y1 },
        blockers: [...mask].sort(),
        portals: [],
      });
      currentSlab.push(id);
      if (row > 0 && !connect(id - 1, id, "x", y0, x0, x1)) return undefined;
    }

    // Two sorted interval lists suffice; no Cartesian product of global x/y boundaries.
    let prior = 0;
    let current = 0;
    while (prior < previousSlab.length && current < currentSlab.length) {
      const a = cells[previousSlab[prior]!]!;
      const b = cells[currentSlab[current]!]!;
      const min = Math.max(a.rect.top, b.rect.top);
      const max = Math.min(a.rect.bottom, b.rect.bottom);
      if (!connect(a.id, b.id, "y", x0, min, max)) return undefined;
      if (++work > MAX_SCENE_WORK) return undefined;
      if (a.rect.bottom < b.rect.bottom) prior += 1;
      else if (b.rect.bottom < a.rect.bottom) current += 1;
      else {
        prior += 1;
        current += 1;
      }
    }
    previousSlab = currentSlab;
  }

  // Global slicers cut cells no local obstacle justifies: one obstacle edge
  // partitions the whole board, so free space arrives as narrow strips beside
  // walls that only exist elsewhere. Merge neighbours with identical blockers
  // whose union stays a rectangle — the seam between them was never a wall —
  // then renumber and refresh portal spans to the merged extents.
  {
    const mergeable = cells.map((cell) => ({
      id: cell.id,
      rect: cell.rect,
      blockers: cell.blockers,
      portals: [...cell.portals],
      dead: false,
    }));
    const links = portals.map((portal) => ({ ...portal, dead: false }));
    const sameBlockers = (a: (typeof mergeable)[number], b: (typeof mergeable)[number]) =>
      a.blockers.length === b.blockers.length && a.blockers.every((id, index) => id === b.blockers[index]);
    let merged = true;
    while (merged && work <= MAX_SCENE_WORK) {
      merged = false;
      work += links.length;
      for (const link of links) {
        if (link.dead) continue;
        const a = mergeable[link.a]!;
        const b = mergeable[link.b]!;
        if (a.dead || b.dead || !sameBlockers(a, b)) continue;
        const aligned =
          link.axis === "x"
            ? a.rect.left === b.rect.left && a.rect.right === b.rect.right
            : a.rect.top === b.rect.top && a.rect.bottom === b.rect.bottom;
        if (!aligned) continue;
        a.rect =
          link.axis === "x"
            ? {
                left: a.rect.left,
                top: Math.min(a.rect.top, b.rect.top),
                right: a.rect.right,
                bottom: Math.max(a.rect.bottom, b.rect.bottom),
              }
            : {
                left: Math.min(a.rect.left, b.rect.left),
                top: a.rect.top,
                right: Math.max(a.rect.right, b.rect.right),
                bottom: a.rect.bottom,
              };
        link.dead = true;
        for (const id of b.portals) {
          const other = links[id]!;
          if (other.dead || other === link) continue;
          if (other.a === b.id) other.a = a.id;
          else if (other.b === b.id) other.b = a.id;
          if (other.a === other.b) {
            other.dead = true;
            continue;
          }
          if (!a.portals.includes(id)) a.portals.push(id);
        }
        b.dead = true;
        b.portals.length = 0;
        merged = true;
      }
    }
    const renumber = new Map<number, number>();
    const mergedCells: typeof cells = [];
    for (const cell of mergeable) {
      if (cell.dead) continue;
      renumber.set(cell.id, mergedCells.length);
      mergedCells.push({ id: mergedCells.length, rect: cell.rect, blockers: cell.blockers, portals: [] });
    }
    const mergedPortals: typeof portals = [];
    const seenLinks = new Set<string>();
    for (const link of links) {
      if (link.dead) continue;
      const a = renumber.get(link.a);
      const b = renumber.get(link.b);
      if (a === undefined || b === undefined || a === b) continue;
      const first = mergedCells[a]!.rect;
      const second = mergedCells[b]!.rect;
      const min = link.axis === "x" ? Math.max(first.left, second.left) : Math.max(first.top, second.top);
      const max = link.axis === "x" ? Math.min(first.right, second.right) : Math.min(first.bottom, second.bottom);
      if (max - min <= EPSILON) continue;
      const key = `${a}|${b}|${link.axis}|${link.fixed}|${min}|${max}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      const id = mergedPortals.length;
      mergedPortals.push({ id, a, b, axis: link.axis, fixed: link.fixed, min, max });
      mergedCells[a]!.portals.push(id);
      mergedCells[b]!.portals.push(id);
    }
    work += mergedCells.length + mergedPortals.length;
    if (work > MAX_SCENE_WORK) return undefined;
    cells.length = 0;
    cells.push(...mergedCells);
    portals.length = 0;
    portals.push(...mergedPortals);
  }
  return { bounds: sceneBounds, obstacles, cells, portals, parents, kinds, bundles };
}

function descendantOf(scene: RoutingScene, elementId: string, groupId: string): boolean {
  for (let parent = scene.parents.get(elementId); parent; parent = scene.parents.get(parent)) {
    if (parent === groupId) return true;
  }
  return false;
}

function terminals(
  scene: RoutingScene,
  elementId: string,
  inward: boolean,
  blocked: ReadonlySet<number>,
): RoutingTerminal[] {
  const placement = scene.bounds.get(elementId);
  if (!placement) return [];
  const rect = rectangle(placement);
  const result: RoutingTerminal[] = [];
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const axis = side === "top" || side === "bottom" ? "x" : "y";
    const fixed =
      side === "top" ? rect.top : side === "bottom" ? rect.bottom : side === "left" ? rect.left : rect.right;
    const [minimum, maximum] = portRange(rect, side);
    const face: RoutingTerminal[] = [];
    for (const cell of scene.cells) {
      if (blocked.has(cell.id)) continue;
      const span = cell.rect;
      const touching =
        side === "top"
          ? Math.abs((inward ? span.top : span.bottom) - fixed) <= EPSILON &&
            (inward ? span.bottom > fixed : span.top < fixed)
          : side === "bottom"
            ? Math.abs((inward ? span.bottom : span.top) - fixed) <= EPSILON &&
              (inward ? span.top < fixed : span.bottom > fixed)
            : side === "left"
              ? Math.abs((inward ? span.left : span.right) - fixed) <= EPSILON &&
                (inward ? span.right > fixed : span.left < fixed)
              : Math.abs((inward ? span.right : span.left) - fixed) <= EPSILON &&
                (inward ? span.left < fixed : span.right > fixed);
      if (!touching) continue;
      let min = Math.max(minimum, axis === "x" ? span.left : span.top);
      let max = Math.min(maximum, axis === "x" ? span.right : span.bottom);
      if (max - min <= EPSILON) continue;
      const inset = Math.min(8, (max - min) / 4);
      min += inset;
      max -= inset;
      face.push({
        key: JSON.stringify([elementId, side, cell.id]),
        elementId,
        side,
        cell: cell.id,
        axis,
        fixed,
        min,
        max,
        inward,
      });
    }
    const midpoint = (minimum + maximum) / 2;
    face.sort(
      (a, b) => Math.abs((a.min + a.max) / 2 - midpoint) - Math.abs((b.min + b.max) / 2 - midpoint) || a.cell - b.cell,
    );
    result.push(...face);
  }
  return result;
}

function createRoutingQuery(
  scene: RoutingScene,
  projection: DependencyRoutingProjection,
): Readonly<{
  blocked: ReadonlySet<number>;
  obstacles: readonly Rectangle[];
  sources: readonly RoutingTerminal[];
  targets: readonly RoutingTerminal[];
}> {
  // Projections explicitly distinguish whole groups, loose-node bundles and nodes.
  // A whole-group relationship must never be redirected to its internal bundle.
  const sourceId = projection.sourceId;
  const targetId = projection.targetId;
  const exempt = new Set<string>();
  for (const id of [sourceId, targetId]) {
    for (let parent = scene.parents.get(id); parent; parent = scene.parents.get(parent)) exempt.add(parent);
  }
  const inwardSource = scene.kinds.get(sourceId) === "group" && descendantOf(scene, targetId, sourceId);
  const inwardTarget = scene.kinds.get(targetId) === "group" && descendantOf(scene, sourceId, targetId);
  if (inwardSource) exempt.add(sourceId);
  if (inwardTarget) exempt.add(targetId);
  for (const obstacle of scene.obstacles) {
    if (
      obstacle.kind === "virtual" &&
      obstacle.members?.some((id) => id === projection.sourceId || id === projection.targetId)
    ) {
      exempt.add(obstacle.id);
    }
  }
  const blocked = new Set<number>();
  for (const cell of scene.cells) {
    if (cell.blockers.some((id) => !exempt.has(id))) blocked.add(cell.id);
  }
  return {
    blocked,
    obstacles: scene.obstacles.filter(({ id }) => !exempt.has(id)).map(({ rect }) => rect),
    sources: terminals(scene, sourceId, inwardSource, blocked),
    targets: terminals(scene, targetId, inwardTarget, blocked),
  };
}

type WorkBudget = { remaining: number; exhausted: boolean };
function spend(budget: WorkBudget, amount = 1): boolean {
  if (budget.remaining < amount) {
    budget.exhausted = true;
    return false;
  }
  budget.remaining -= amount;
  return true;
}

type RoutingResource = Readonly<{
  key: string;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
  preferred?: number;
  terminal?: RoutingTerminal;
}>;
type RouteCandidate = Readonly<{
  edge: DependencyRoutingProjection;
  resources: readonly RoutingResource[];
  cells: readonly number[];
  length: number;
  cost: number;
}>;
type RoutingRequest = Readonly<{
  edge: DependencyRoutingProjection;
  query: ReturnType<typeof createRoutingQuery>;
  candidates: readonly RouteCandidate[];
}>;
type RoutingPlan = Readonly<{
  selected: ReadonlyMap<string, RouteCandidate>;
  orders: ReadonlyMap<string, readonly string[]>;
  cost: number;
}>;

function resourcePoint(resource: RoutingResource, coordinate: number): Point {
  return resource.axis === "x" ? { x: coordinate, y: resource.fixed } : { x: resource.fixed, y: coordinate };
}

function terminalResource(terminal: RoutingTerminal): RoutingResource {
  return { ...terminal, key: `t:${terminal.key}`, terminal };
}

const manhattanDistance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

type SearchState = {
  cell: number;
  resource: RoutingResource;
  point: Point;
  length: number;
  cost: number;
  priority: number;
  previous?: SearchState;
};

function search(
  scene: RoutingScene,
  edge: DependencyRoutingProjection,
  query: RoutingRequest["query"],
  budget: WorkBudget,
  penalties: ReadonlyMap<string, number>,
): RouteCandidate | undefined {
  if (!query.sources.length || !query.targets.length) return;
  const targets = new Map<number, RoutingResource[]>();
  for (const target of query.targets) {
    const entries = targets.get(target.cell) ?? [];
    entries.push(terminalResource(target));
    targets.set(target.cell, entries);
  }
  const sourceBounds = scene.bounds.get(edge.sourceId)!;
  const targetBounds = scene.bounds.get(edge.targetId)!;
  const sourceRect = rectangle(sourceBounds);
  const targetRect = rectangle(targetBounds);
  const project = (point: Point, resource: RoutingResource) =>
    resourcePoint(resource, Math.max(resource.min, Math.min(resource.max, point[resource.axis])));
  const targetResources = query.targets.map(terminalResource);
  const estimate = (point: Point) =>
    targetResources.reduce(
      (best, target) => Math.min(best, manhattanDistance(point, project(point, target))),
      Infinity,
    );
  const terminalCost = (terminal: RoutingTerminal, source: boolean) => {
    const sideCost = source
      ? terminal.side === "bottom"
        ? 0
        : terminal.side === "top"
          ? 256
          : 64
      : terminal.side === "bottom"
        ? 256
        : 0;
    const along = center(source ? sourceRect : targetRect)[terminal.axis];
    return (
      sideCost +
      Math.abs((terminal.min + terminal.max) / 2 - along) * 0.15 +
      (penalties.get(JSON.stringify([terminal.elementId, terminal.side])) ?? 0)
    );
  };
  const heap = new MinHeap<SearchState>();
  const labels = new Map<string, SearchState[]>();
  for (const terminal of query.sources) {
    const resource = terminalResource(terminal);
    const point = project(center(targetRect), resource);
    const cost = terminalCost(terminal, true);
    heap.push({ cell: terminal.cell, resource, point, length: 0, cost, priority: cost + estimate(point) });
  }
  let final: SearchState | undefined;
  let end: RoutingResource | undefined;
  let best = Infinity;
  while (true) {
    const current = heap.pop();
    if (!current || current.priority >= best) break;
    if (!spend(budget)) break;
    const key = `${current.cell}:${current.resource.key}`;
    if (!current.resource.terminal && !labels.get(key)?.includes(current)) continue;
    const from = current.point;
    for (const target of targets.get(current.cell) ?? []) {
      const length = manhattanDistance(from, project(from, target));
      const cost =
        current.cost +
        length +
        (current.resource.axis === target.axis ? 0 : 128) +
        terminalCost(target.terminal!, false);
      if (cost < best) {
        best = cost;
        final = current;
        end = target;
      }
    }
    for (const id of scene.cells[current.cell]!.portals) {
      if (!spend(budget)) break;
      const portal = scene.portals[id]!;
      const nextCell = portal.a === current.cell ? portal.b : portal.a;
      if (query.blocked.has(nextCell) || nextCell === current.previous?.cell) continue;
      const inset = Math.min(PORTAL_MARGIN, (portal.max - portal.min) / 4);
      const resource: RoutingResource = {
        key: `p:${id}`,
        axis: portal.axis,
        fixed: portal.fixed,
        min: portal.min + inset,
        max: portal.max - inset,
      };
      if (resource.key === current.resource.key) continue;
      const point = project(from, resource);
      const length = current.length + manhattanDistance(from, point);
      const cost =
        current.cost +
        manhattanDistance(from, point) +
        (current.resource.axis === resource.axis ? 0 : 128) +
        (penalties.get(resource.key) ?? 0);
      const nextKey = `${nextCell}:${resource.key}`;
      const existing = labels.get(nextKey) ?? [];
      if (
        existing.some((state) => state.cost + manhattanDistance(state.point, point) <= cost && state.length <= length)
      )
        continue;
      const retained = existing.filter(
        (state) => !(cost + manhattanDistance(point, state.point) <= state.cost && length <= state.length),
      );
      const next = {
        cell: nextCell,
        resource,
        point,
        length,
        cost,
        priority: cost + estimate(point),
        previous: current,
      };
      retained.push(next);
      retained.sort(
        (a, b) => a.priority - b.priority || a.length - b.length || a.point.x - b.point.x || a.point.y - b.point.y,
      );
      labels.set(nextKey, retained.slice(0, 4));
      if (retained.indexOf(next) < 4) heap.push(next);
    }
  }
  if (!final || !end) return;
  const states: SearchState[] = [];
  for (let state: SearchState | undefined = final; state; state = state.previous) states.push(state);
  states.reverse();
  const cells = states.map(({ cell }) => cell);
  if (new Set(cells).size !== cells.length) return;
  return {
    edge,
    cells,
    resources: [
      ...states.map(({ resource, point }) => ({ ...resource, preferred: point[resource.axis] })),
      { ...end, preferred: project(final.point, end)[end.axis] },
    ],
    length: final.length + manhattanDistance(final.point, project(final.point, end)),
    cost: best,
  };
}

function collectRoutingRequests(
  scene: RoutingScene,
  edges: readonly DependencyRoutingProjection[],
  budget: WorkBudget,
): RoutingRequest[] {
  const requests = edges.map((edge) => {
    const query = createRoutingQuery(scene, edge);
    const first = search(scene, edge, query, budget, new Map());
    return { edge, query, candidates: first ? [first] : [] };
  });
  // Every relationship gets its independent candidate before alternatives consume work.
  for (const request of requests) {
    const penalties = new Map<string, number>();
    const seen = new Set(request.candidates.map((candidate) => candidate.resources.map(({ key }) => key).join("|")));
    for (let alternative = 0; alternative < 2 && !budget.exhausted; alternative += 1) {
      for (const resource of request.candidates.at(-1)?.resources ?? []) {
        const key = resource.terminal
          ? JSON.stringify([resource.terminal.elementId, resource.terminal.side])
          : resource.key;
        penalties.set(key, (penalties.get(key) ?? 0) + (resource.terminal ? 1_024 : 256));
      }
      const candidate = search(scene, request.edge, request.query, budget, penalties);
      if (!candidate) break;
      const key = candidate.resources.map(({ key }) => key).join("|");
      if (seen.has(key)) break;
      seen.add(key);
      request.candidates.push(candidate);
    }
  }
  return requests;
}

function slotCoordinate(resource: RoutingResource, index: number, count: number): number {
  // Route tracks pack at TRACK_GAP inside a centered TRACK_WIDTH band; compression only
  // when the band itself cannot fit every track.
  const band = Math.min(TRACK_WIDTH, resource.max - resource.min);
  const gap = Math.min(TRACK_GAP, band / Math.max(1, count - 1));
  return (resource.min + resource.max) / 2 + (index - (count - 1) / 2) * gap;
}

// Cost per pixel between an ordered slot's estimated coordinate and its preferred
// one: large enough to decide rank ties, below a crossing (4,000).
const PREFERENCE_COST = 4;

// Where a slot roughly lands given its order neighbours: separations pin it
// within a gap of the neighbours' own preferred coordinates, so a rank on the
// wrong side of a neighbour estimates that neighbour's coordinate, not its own.
// Without this term ranks tie whenever crossings tie and the insertion sequence
// alone decides who sits where on a shared line.
function preferenceCost(
  resource: RoutingResource,
  rank: number,
  order: readonly string[],
  selected: ReadonlyMap<string, RouteCandidate>,
): number {
  const gap = Math.min(TRACK_GAP, Math.min(TRACK_WIDTH, resource.max - resource.min) / Math.max(1, order.length));
  const anchor = resource.preferred ?? (resource.min + resource.max) / 2;
  const neighbour = (id: string) =>
    selected.get(id)?.resources.find((entry) => entry.key === resource.key)?.preferred ??
    (resource.min + resource.max) / 2;
  const lower = rank > 0 ? neighbour(order[rank - 1]!) + gap : -Infinity;
  const upper = rank < order.length ? neighbour(order[rank]!) - gap : Infinity;
  return Math.abs(Math.max(lower, Math.min(upper, anchor)) - anchor) * PREFERENCE_COST;
}

function cellBoundaryPosition(scene: RoutingScene, cell: number, point: Point): number {
  const { left, right, top, bottom } = scene.cells[cell]!.rect;
  const width = right - left;
  const height = bottom - top;
  if (Math.abs(point.y - top) <= EPSILON) return point.x - left;
  if (Math.abs(point.x - right) <= EPSILON) return width + point.y - top;
  if (Math.abs(point.y - bottom) <= EPSILON) return width + height + right - point.x;
  return width * 2 + height + bottom - point.y;
}

function alternating(a: number, b: number, c: number, d: number): boolean {
  const inside = (point: number) => point > Math.min(a, b) + EPSILON && point < Math.max(a, b) - EPSILON;
  return inside(c) !== inside(d);
}

type CellConnection = Readonly<{ edgeId: string; from: RoutingResource; to: RoutingResource }>;
function cellConnections(plan: RoutingPlan): Map<number, CellConnection[]> {
  const result = new Map<number, CellConnection[]>();
  for (const candidate of plan.selected.values()) {
    candidate.cells.forEach((cell, index) => {
      const entries = result.get(cell) ?? [];
      entries.push({
        edgeId: candidate.edge.id,
        from: candidate.resources[index]!,
        to: candidate.resources.at(index + 1)!,
      });
      result.set(cell, entries);
    });
  }
  return result;
}

function insertion(
  scene: RoutingScene,
  plan: RoutingPlan,
  candidate: RouteCandidate,
  demand: ReadonlyMap<string, number>,
  budget: WorkBudget,
): Readonly<{ ranks: readonly number[]; cost: number }> | undefined {
  const connections = cellConnections(plan);
  type Rank = { rank: number; cost: number; previous?: Rank };
  let states: Rank[] = [];
  for (let index = 0; index < candidate.resources.length; index += 1) {
    const resource = candidate.resources[index]!;
    const order = plan.orders.get(resource.key) ?? [];
    if (order.length * MIN_GAP > resource.max - resource.min + EPSILON) return;
    const pressure = Math.max(
      0,
      (order.length + (demand.get(resource.key) ?? 0) + 1) * TRACK_GAP - (resource.max - resource.min),
    );
    const next: Rank[] = [];
    for (let rank = 0; rank <= order.length; rank += 1) {
      if (!spend(budget)) return;
      if (index === 0) {
        states.push({ rank, cost: pressure + preferenceCost(resource, rank, order, plan.selected) });
        continue;
      }
      const previousResource = candidate.resources.at(index - 1)!;
      const previousOrder = plan.orders.get(previousResource.key) ?? [];
      const cell = candidate.cells.at(index - 1)!;
      let best: Rank | undefined;
      for (const prior of states) {
        if (!spend(budget)) return;
        const a = cellBoundaryPosition(
          scene,
          cell,
          resourcePoint(previousResource, slotCoordinate(previousResource, prior.rank, previousOrder.length + 1)),
        );
        const b = cellBoundaryPosition(
          scene,
          cell,
          resourcePoint(resource, slotCoordinate(resource, rank, order.length + 1)),
        );
        let crossings = 0;
        for (const connection of connections.get(cell) ?? []) {
          if (!spend(budget)) return;
          const position = (entry: RoutingResource) => {
            const entries = plan.orders.get(entry.key) ?? [];
            let at = entries.indexOf(connection.edgeId);
            let count = entries.length;
            const inserted =
              entry.key === resource.key ? rank : entry.key === previousResource.key ? prior.rank : undefined;
            if (inserted !== undefined) {
              if (at >= inserted) at += 1;
              count += 1;
            }
            return cellBoundaryPosition(scene, cell, resourcePoint(entry, slotCoordinate(entry, at, count)));
          };
          if (alternating(a, b, position(connection.from), position(connection.to))) crossings += 1;
        }
        const cost = prior.cost + crossings * 4_000 + pressure + preferenceCost(resource, rank, order, plan.selected);
        if (!best || cost < best.cost) best = { rank, cost, previous: prior };
      }
      if (best) next.push(best);
    }
    if (index > 0) states = next;
    if (!states.length) return;
  }
  const final = states.reduce((best, state) => (state.cost < best.cost ? state : best));
  const ranks: number[] = [];
  for (let state: Rank | undefined = final; state; state = state.previous) ranks.push(state.rank);
  ranks.reverse();
  return { ranks, cost: final.cost + candidate.cost };
}

function selectRoutingPlan(
  scene: RoutingScene,
  requests: readonly RoutingRequest[],
  budget: WorkBudget,
  extended = false,
  preferred: ReadonlyMap<string, RouteCandidate> = new Map(),
): RoutingPlan {
  const demand = new Map<string, number>();
  for (const request of requests) {
    for (const key of new Set(request.candidates.at(0)?.resources.map(({ key }) => key) ?? [])) {
      demand.set(key, (demand.get(key) ?? 0) + 1);
    }
  }
  let plan: RoutingPlan = { selected: new Map(), orders: new Map(), cost: 0 };
  const available = new Map(
    requests.map((request) => {
      const baseline = request.candidates.at(0)?.length ?? 0;
      const maximum = baseline + Math.max(extended ? 1_024 : 256, baseline * (extended ? 1 : 0.25));
      return [
        request.edge.id,
        request.candidates.filter((candidate) => candidate.length <= maximum + EPSILON),
      ] as const;
    }),
  );
  const ordered = [...requests].sort(
    (a, b) =>
      available.get(a.edge.id)!.length - available.get(b.edge.id)!.length ||
      a.edge.id.localeCompare(b.edge.id) ||
      (a.edge.id < b.edge.id ? -1 : Number(a.edge.id > b.edge.id)),
  );
  for (const request of ordered) {
    let best: { candidate: RouteCandidate; result: NonNullable<ReturnType<typeof insertion>> } | undefined;
    const baseline = request.candidates.at(0);
    if (!baseline) continue;
    for (const resource of baseline.resources)
      demand.set(resource.key, Math.max(0, (demand.get(resource.key) ?? 0) - 1));
    const eligible = available.get(request.edge.id)!;
    const candidates = preferred.has(request.edge.id) ? [preferred.get(request.edge.id)!] : eligible;
    for (const candidate of candidates) {
      if (!eligible.includes(candidate)) continue;
      const result = insertion(scene, plan, candidate, demand, budget);
      if (result && (!best || result.cost < best.result.cost)) best = { candidate, result };
    }
    if (!best) continue;
    const selected = new Map(plan.selected);
    const orders = new Map(plan.orders);
    selected.set(request.edge.id, best.candidate);
    best.candidate.resources.forEach((resource, index) => {
      const order = [...(orders.get(resource.key) ?? [])];
      order.splice(best.result.ranks[index]!, 0, request.edge.id);
      orders.set(resource.key, order);
    });
    plan = { selected, orders, cost: plan.cost + best.result.cost };
  }
  return plan;
}

function independentPlan(candidate: RouteCandidate): RoutingPlan {
  return {
    selected: new Map([[candidate.edge.id, candidate]]),
    orders: new Map(candidate.resources.map(({ key }) => [key, [candidate.edge.id]])),
    cost: candidate.cost,
  };
}

type Slot = Readonly<{ edgeId: string; resource: RoutingResource; preferred: number }>;
type Separation = Readonly<{ before: number; after: number; preferred: number }>;
type Connection = Readonly<{
  edgeId: string;
  cell: number;
  index: number;
  from: Point;
  to: Point;
  entry: RoutingResource;
  exit: RoutingResource;
}>;
type ConnectionPath = Readonly<{ points: readonly Point[]; cost: number; compression: number; gap: number }>;
type PlacedSegment = Segment & Readonly<{ edgeId: string; cell: number; gap: number }>;

const MAX_ALIGNMENT_RETRIES = 128;
const MAX_CELL_AXIS_COORDINATES = 20;
const MAX_CELL_EXPANSIONS = 1_024;
const MAX_CELL_ATTEMPT_WORK = 32_768;
const CROSSING_COST = 4_000;
const BEND_COST = 128;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roots(parent: readonly number[]): number[] {
  return parent.map((_, index) => {
    while (parent[index] !== index) index = parent[index]!;
    return index;
  });
}

function join(parent: number[], first: number, second: number): void {
  while (parent[first] !== first) first = parent[first]!;
  while (parent[second] !== second) second = parent[second]!;
  parent[Math.max(first, second)] = Math.min(first, second);
}

function solveSlots(
  slots: readonly Slot[],
  separations: readonly Separation[],
  parent: readonly number[],
  budget: WorkBudget,
): number[] | undefined {
  if (!spend(budget, slots.length + separations.length)) return;
  const root = roots(parent);
  const components = new Map<
    number,
    { min: number; max: number; sum: number; weight: number; fallbackSum: number; count: number }
  >();
  slots.forEach((slot, index) => {
    const id = root[index]!;
    const component = components.get(id) ?? {
      min: -Infinity,
      max: Infinity,
      sum: 0,
      weight: 0,
      fallbackSum: 0,
      count: 0,
    };
    component.min = Math.max(component.min, slot.resource.min);
    component.max = Math.min(component.max, slot.resource.max);
    component.fallbackSum += slot.preferred;
    component.count += 1;
    if (slot.resource.terminal) {
      component.sum += slot.preferred;
      component.weight += 1;
    }
    components.set(id, component);
  });
  const outgoing = new Map<number, Map<number, number>>();
  const indegree = new Map([...components.keys()].map((id) => [id, 0]));
  for (const separation of separations) {
    const before = root[separation.before]!;
    const after = root[separation.after]!;
    if (before === after) return;
    const gap = separation.preferred;
    const edges = outgoing.get(before) ?? new Map<number, number>();
    if (!edges.has(after)) indegree.set(after, indegree.get(after)! + 1);
    edges.set(after, Math.max(edges.get(after) ?? 0, gap));
    outgoing.set(before, edges);
  }
  const ordered = [...components.keys()].filter((id) => indegree.get(id) === 0);
  for (let cursor = 0; cursor < ordered.length; cursor += 1) {
    const id = ordered[cursor]!;
    const component = components.get(id)!;
    if (component.min > component.max + EPSILON) return;
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      const successor = components.get(next)!;
      successor.min = Math.max(successor.min, component.min + gap);
      const count = indegree.get(next)! - 1;
      indegree.set(next, count);
      if (count === 0) ordered.push(next);
    }
  }
  if (ordered.length !== components.size) return;
  for (let cursor = ordered.length - 1; cursor >= 0; cursor -= 1) {
    const id = ordered[cursor]!;
    const component = components.get(id)!;
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      component.max = Math.min(component.max, components.get(next)!.max - gap);
    }
    if (component.min > component.max + EPSILON) return;
  }
  const values = new Map<number, number>();
  for (const id of ordered) {
    const component = components.get(id)!;
    const desired = component.weight ? component.sum / component.weight : component.fallbackSum / component.count;
    const coordinate = clamp(desired, component.min, component.max);
    values.set(id, coordinate);
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      const successor = components.get(next)!;
      successor.min = Math.max(successor.min, coordinate + gap);
    }
  }
  return root.map((id) => values.get(id)!);
}

function assignSlots(
  plan: RoutingPlan,
  budget: WorkBudget,
  departureAnchors?: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly number[]> | undefined {
  const slots: Slot[] = [];
  const indices = new Map<string, Map<string, number>>();
  const routes = new Map<string, number[]>();
  const separations: Separation[] = [];
  const alignments: Array<readonly number[]> = [];
  // Consecutive same-axis resources of one edge carry the same pack of edges past
  // every portal, but each portal sizes its track gap from its own width — a pack
  // crossing portals of different widths re-spaces at each boundary and every
  // member draws a stair. Unify the gap across a chain to one that fits the
  // narrowest overlap of the chain's ranges so the pack keeps one layout and the
  // per-edge alignment joins stay solvable. The pack's centre needs the same
  // treatment: each resource clamps its preferred coordinate to its own span, so
  // unequal ranges split the middle and every member jogs between resources.
  const chainGap = new Map<string, number>();
  const chainMiddle = new Map<string, number>();
  // A centre is directional while a gap is not: merging two chains' gaps keeps
  // every member no closer than the tighter spacing, but merging their centres
  // drags one chain's pack onto the other's row. Unify the centre only for a
  // chain whose resources no other chain claims.
  const chainClaims = new Map<string, number>();
  for (const candidate of plan.selected.values()) {
    let run: RoutingResource[] = [];
    const count = () => {
      if (run.length > 1)
        for (const resource of run) chainClaims.set(resource.key, (chainClaims.get(resource.key) ?? 0) + 1);
      run = [];
    };
    for (const resource of candidate.resources) {
      const previous = run.at(-1);
      if (previous && (previous.axis !== resource.axis || previous.fixed === resource.fixed)) count();
      run.push(resource);
    }
    count();
  }
  const baseGap = (resource: RoutingResource): number => {
    const count = Math.max(1, (plan.orders.get(resource.key) ?? []).length - 1);
    return Math.min(TRACK_GAP, Math.min(TRACK_WIDTH, resource.max - resource.min) / count);
  };
  for (const candidate of plan.selected.values()) {
    let run: RoutingResource[] = [];
    const flush = () => {
      if (run.length > 1) {
        const low = Math.max(...run.map(({ min }) => min));
        const high = Math.min(...run.map(({ max }) => max));
        const [first, ...rest] = run.map((resource) => new Set(plan.orders.get(resource.key) ?? []));
        const common = rest.reduce((members, order) => members.filter((id) => order.has(id)), [...first]);
        const unified = Math.min(...run.map(baseGap), (high - low) / Math.max(1, common.length - 1));
        // Below MIN_GAP the pack cannot hold one layout through this chain at all;
        // leaving the per-portal gaps in place beats collapsing the corridor.
        if (unified >= MIN_GAP) {
          for (const resource of run)
            chainGap.set(resource.key, Math.min(chainGap.get(resource.key) ?? Infinity, unified));
          if (run.every((resource) => (chainClaims.get(resource.key) ?? 0) === 1)) {
            const centreOf = (resource: RoutingResource): number => {
              const count = (plan.orders.get(resource.key) ?? []).length;
              const halfSpan = (Math.max(0, count - 1) * unified) / 2;
              return clamp(
                resource.preferred ?? (resource.min + resource.max) / 2,
                resource.min + halfSpan,
                resource.max - halfSpan,
              );
            };
            // The narrowest clamped centre governs, matching the gap rule.
            const centre = Math.min(...run.map(centreOf));
            for (const resource of run) chainMiddle.set(resource.key, centre);
          }
        }
      }
      run = [];
    };
    for (const resource of candidate.resources) {
      const previous = run.at(-1);
      if (previous && (previous.axis !== resource.axis || previous.fixed === resource.fixed)) flush();
      run.push(resource);
    }
    flush();
  }
  for (const [edgeId, candidate] of [...plan.selected].sort(([a], [b]) => a.localeCompare(b))) {
    const route: number[] = [];
    let run: number[] = [];
    for (const [position, resource] of candidate.resources.entries()) {
      if (!spend(budget)) return;
      const order = plan.orders.get(resource.key) ?? [];
      const rank = order.indexOf(edgeId);
      if (rank < 0 || (order.length - 1) * MIN_GAP > resource.max - resource.min + EPSILON) return;
      const gap = chainGap.get(resource.key) ?? baseGap(resource);
      const halfSpan = ((order.length - 1) * gap) / 2;
      const anchor = position === 0 ? departureAnchors?.get(edgeId) : undefined;
      const middle = clamp(
        chainMiddle.get(resource.key) ?? resource.preferred ?? (resource.min + resource.max) / 2,
        resource.min + halfSpan,
        resource.max - halfSpan,
      );
      const index = slots.length;
      slots.push({
        edgeId,
        resource,
        // An anchor is the coordinate this edge's own route settled on, not a
        // pack centre to offset a rank from — the rank correction would drag the
        // port off the measured column and reintroduce the departure jog.
        preferred:
          anchor !== undefined
            ? clamp(anchor, resource.min, resource.max)
            : middle + (rank - (order.length - 1) / 2) * gap,
      });
      const entries = indices.get(resource.key) ?? new Map<string, number>();
      entries.set(edgeId, index);
      indices.set(resource.key, entries);
      const previous = slots[run.at(-1) ?? -1]?.resource;
      if (previous && (previous.axis !== resource.axis || previous.fixed === resource.fixed)) {
        if (run.length > 1) alignments.push(run);
        run = [];
      }
      run.push(index);
      route.push(index);
    }
    if (run.length > 1) alignments.push(run);
    routes.set(edgeId, route);
  }
  for (const [key, order] of plan.orders) {
    const entries = indices.get(key);
    if (!entries) continue;
    for (let index = 1; index < order.length; index += 1) {
      if (!spend(budget)) return;
      const before = entries.get(order[index - 1]!);
      const after = entries.get(order[index]!);
      if (before === undefined || after === undefined) continue;
      const resource = slots[before]!.resource;
      separations.push({ before, after, preferred: chainGap.get(key) ?? baseGap(resource) });
    }
  }
  // Same-line reservations: portals and terminals sharing a geometric line (same
  // axis and fixed coordinate) are distinct resources, so without this their slots
  // solve to overlapping coordinates — the port collision. Space every line like
  // one shared corridor by joining nearest neighbours in preferred order.
  const lines = new Map<string, number[]>();
  for (const entries of indices.values()) {
    for (const index of entries.values()) {
      const resource = slots[index]!.resource;
      const line = `${resource.axis}:${Math.round(resource.fixed)}`;
      lines.set(line, [...(lines.get(line) ?? []), index]);
    }
  }
  const lineSeparations: Separation[] = [];
  const outgoing = new Map<number, Set<number>>();
  for (const { before, after } of separations) {
    const set = outgoing.get(before) ?? new Set();
    set.add(after);
    outgoing.set(before, set);
  }
  const reaches = (from: number, to: number): boolean => {
    const seen = new Set<number>();
    const queue = [...(outgoing.get(from) ?? [])];
    while (queue.length) {
      const current = queue.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(outgoing.get(current) ?? []));
    }
    return false;
  };
  for (const members of lines.values()) {
    const ordered = members.sort((a, b) => slots[a]!.preferred - slots[b]!.preferred || a - b);
    for (let index = 1; index < ordered.length; index += 1) {
      const before = ordered[index - 1]!;
      const after = ordered[index]!;
      if (slots[before]!.edgeId === slots[after]!.edgeId) continue;
      // Skip pairs that would close a cycle against the per-resource order chains.
      if (reaches(after, before)) continue;
      lineSeparations.push({ before, after, preferred: MIN_GAP });
      const set = outgoing.get(before) ?? new Set();
      set.add(after);
      outgoing.set(before, set);
    }
  }
  separations.push(...lineSeparations);
  const separate = slots.map((_, index) => index);
  const together = [...separate];
  const mergeRun = (parent: number[], run: readonly number[]) => {
    let minimum = -Infinity;
    let maximum = Infinity;
    let previous: number | undefined;
    for (const index of run) {
      const resource = slots[index]!.resource;
      const low = Math.max(minimum, resource.min);
      const high = Math.min(maximum, resource.max);
      if (low > high + EPSILON) {
        minimum = resource.min;
        maximum = resource.max;
      } else {
        if (previous !== undefined) join(parent, previous, index);
        minimum = low;
        maximum = high;
      }
      previous = index;
    }
  };
  for (const run of alignments) mergeRun(together, run);
  // Same-line reservations must never make the solve infeasible: when they do,
  // drop them and continue with the pre-reservation separation set.
  const baseSeparations = separations.filter((separation) => !lineSeparations.includes(separation));
  let effective = separations;
  let values = solveSlots(slots, effective, together, budget);
  if (!values && !budget.exhausted && lineSeparations.length) {
    effective = baseSeparations;
    values = solveSlots(slots, effective, together, budget);
  }
  if (!values && !budget.exhausted) {
    let parent = separate;
    values = solveSlots(slots, effective, parent, budget);
    if (!values) return;
    // Release conflicting alignments instead of squeezing every corridor to the minimum gap.
    for (const run of alignments.slice(0, MAX_ALIGNMENT_RETRIES)) {
      if (!spend(budget, run.length)) return;
      const trial = [...parent];
      mergeRun(trial, run);
      const solved = solveSlots(slots, effective, trial, budget);
      if (solved) {
        parent = trial;
        values = solved;
      }
      if (budget.exhausted) return;
    }
  }
  if (!values) return;
  return new Map([...routes].map(([id, route]) => [id, route.map((index) => values[index]!)]));
}

function within(value: number, from: number, to: number): boolean {
  return value >= Math.min(from, to) - EPSILON && value <= Math.max(from, to) + EPSILON;
}

function spacingInteraction(
  first: Segment,
  second: Segment,
  gap = MIN_GAP,
): Readonly<{ valid: boolean; crossing: number; compression: number }> {
  if (first.axis === second.axis) {
    const fixed = first.axis === "horizontal" ? "y" : "x";
    const variable = first.axis === "horizontal" ? "x" : "y";
    const distance = Math.abs(first.from[fixed] - second.from[fixed]);
    const low = Math.max(
      Math.min(first.from[variable], first.to[variable]),
      Math.min(second.from[variable], second.to[variable]),
    );
    const high = Math.min(
      Math.max(first.from[variable], first.to[variable]),
      Math.max(second.from[variable], second.to[variable]),
    );
    const clearance = Math.hypot(distance, Math.max(0, low - high));
    return {
      valid: clearance > EPSILON && (high - low <= EPSILON || distance >= gap - EPSILON),
      crossing: 0,
      compression: Math.max(0, TRACK_GAP - distance) * Math.max(0, high - low),
    };
  }
  const horizontal = first.axis === "horizontal" ? first : second;
  const vertical = first.axis === "vertical" ? first : second;
  const x = vertical.from.x;
  const y = horizontal.from.y;
  const dx = Math.max(
    Math.min(horizontal.from.x, horizontal.to.x) - x,
    x - Math.max(horizontal.from.x, horizontal.to.x),
    0,
  );
  const dy = Math.max(Math.min(vertical.from.y, vertical.to.y) - y, y - Math.max(vertical.from.y, vertical.to.y), 0);
  if (dx > EPSILON || dy > EPSILON) return { valid: true, crossing: 0, compression: 0 };
  const crossing =
    x > Math.min(horizontal.from.x, horizontal.to.x) + EPSILON &&
    x < Math.max(horizontal.from.x, horizontal.to.x) - EPSILON &&
    y > Math.min(vertical.from.y, vertical.to.y) + EPSILON &&
    y < Math.max(vertical.from.y, vertical.to.y) - EPSILON;
  return { valid: crossing, crossing: crossing ? 1 : 0, compression: 0 };
}

function normal(resource: RoutingResource, rect: Rectangle): Point {
  return resource.axis === "x"
    ? { x: 0, y: Math.abs(resource.fixed - rect.top) <= EPSILON ? 1 : -1 }
    : { x: Math.abs(resource.fixed - rect.left) <= EPSILON ? 1 : -1, y: 0 };
}

function follows(from: Point, to: Point, direction: Point): boolean {
  return direction.x
    ? Math.abs(from.y - to.y) <= EPSILON && (to.x - from.x) * direction.x > EPSILON
    : Math.abs(from.x - to.x) <= EPSILON && (to.y - from.y) * direction.y > EPSILON;
}

function connectorCost(
  points: readonly Point[],
  connection: Connection,
  rect: Rectangle,
  used: readonly PlacedSegment[],
  gap: number,
  budget: WorkBudget,
): Readonly<{ cost: number; compression: number }> | undefined {
  if (
    points.length < 2 ||
    !follows(points.at(0)!, points.at(1)!, normal(connection.entry, rect)) ||
    !follows(points.at(-1)!, points.at(-2)!, normal(connection.exit, rect))
  )
    return;
  for (const point of points) {
    if (!within(point.x, rect.left, rect.right) || !within(point.y, rect.top, rect.bottom)) return;
  }
  const own = segments(points);
  let crossings = 0;
  let compression = 0;
  for (let index = 0; index < own.length; index += 1) {
    const segment = own[index]!;
    if (segment.from.x !== segment.to.x && segment.from.y !== segment.to.y) return;
    for (const prior of used) {
      if (!spend(budget)) return;
      // Cross-cell contacts are checked after collinear pieces have been joined.
      if (prior.cell !== connection.cell && prior.axis !== segment.axis) continue;
      const relation = spacingInteraction(segment, prior, gap);
      if (!relation.valid) return;
      crossings += relation.crossing;
      compression += relation.compression;
    }
    for (let other = 0; other < index - 1; other += 1) {
      if (!spend(budget)) return;
      const relation = spacingInteraction(segment, own[other]!);
      if (!relation.valid || relation.crossing) return;
    }
  }
  return {
    cost: routeLength(points) + Math.max(0, points.length - 2) * BEND_COST + crossings * CROSSING_COST,
    compression,
  };
}

function tracks(min: number, max: number, preferred: number, coordinates: readonly number[], gap: number): number[] {
  const inset = Math.min(PORTAL_MARGIN, (max - min) / 4);
  const low = min + inset;
  const high = max - inset;
  // Only a relaxed attempt may use tracks beside a terminal outside the preferred cell inset.
  const nearEnds = coordinates
    .slice(0, 2)
    .flatMap((coordinate) => [coordinate - gap, coordinate + gap])
    .filter((value) => gap < TRACK_GAP && value >= min + MIN_GAP && value <= max - MIN_GAP);
  const alternatives = [
    (low + high) / 2,
    ...coordinates.flatMap((coordinate) => [
      coordinate - TRACK_GAP,
      coordinate + TRACK_GAP,
      coordinate - gap,
      coordinate + gap,
    ]),
  ].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  // Keep escapes near both endpoints when the bounded cell search samples a long corridor.
  return [
    ...new Set([
      clamp(preferred, low, high),
      low,
      high,
      ...nearEnds,
      ...alternatives.filter((value) => value >= low && value <= high),
    ]),
  ].slice(0, MAX_CELL_AXIS_COORDINATES - 2);
}

function searchConnector(
  connection: Connection,
  rect: Rectangle,
  xs: readonly number[],
  ys: readonly number[],
  used: readonly PlacedSegment[],
  gap: number,
  budget: WorkBudget,
): ConnectionPath | undefined {
  type State = {
    point: Point;
    direction: "horizontal" | "vertical" | undefined;
    cost: number;
    priority: number;
    previous?: State;
  };
  const start = connection.from;
  const end = connection.to;
  const distance = (point: Point) => Math.abs(point.x - end.x) + Math.abs(point.y - end.y);
  const heap = new MinHeap<State>();
  heap.push({ point: start, direction: undefined, cost: 0, priority: distance(start) });
  const best = new Map<string, number>();
  for (let iteration = 0; iteration < MAX_CELL_EXPANSIONS; iteration += 1) {
    if (!spend(budget)) return;
    const state = heap.pop();
    if (!state) return;
    const key = `${state.point.x}:${state.point.y}:${state.direction}`;
    if (state.cost > (best.get(key) ?? Infinity)) continue;
    if (state.point.x === end.x && state.point.y === end.y) {
      const points: Point[] = [];
      for (let current: State | undefined = state; current; current = current.previous) points.push(current.point);
      points.reverse();
      const result = compact(points);
      const resultCost = connectorCost(result, connection, rect, used, gap, budget);
      if (resultCost) return { points: result, ...resultCost, gap };
      continue;
    }
    for (const direction of ["horizontal", "vertical"] as const) {
      for (const coordinate of direction === "horizontal" ? xs : ys) {
        if (!spend(budget)) return;
        const next =
          direction === "horizontal" ? { x: coordinate, y: state.point.y } : { x: state.point.x, y: coordinate };
        if (next.x === state.point.x && next.y === state.point.y) continue;
        if (!state.previous && !follows(start, next, normal(connection.entry, rect))) continue;
        const atEnd = next.x === end.x && next.y === end.y;
        if (atEnd && !follows(end, state.point, normal(connection.exit, rect))) continue;
        if (
          !atEnd &&
          (next.x <= rect.left + EPSILON ||
            next.x >= rect.right - EPSILON ||
            next.y <= rect.top + EPSILON ||
            next.y >= rect.bottom - EPSILON)
        )
          continue;
        const segment: Segment = { from: state.point, to: next, axis: direction };
        let crossings = 0;
        let valid = true;
        for (const prior of used) {
          if (!spend(budget)) return;
          if (prior.cell !== connection.cell && prior.axis !== segment.axis) continue;
          const relation = spacingInteraction(segment, prior, gap);
          if (!relation.valid) {
            valid = false;
            break;
          }
          crossings += relation.crossing;
        }
        if (!valid) continue;
        const cost =
          state.cost +
          Math.abs(next.x - state.point.x) +
          Math.abs(next.y - state.point.y) +
          (state.direction && state.direction !== direction ? BEND_COST : 0) +
          crossings * CROSSING_COST;
        const nextKey = `${next.x}:${next.y}:${direction}`;
        if (cost >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, cost);
        heap.push({ point: next, direction, cost, priority: cost + distance(next), previous: state });
      }
    }
  }
}

function connectCellAtGap(
  connection: Connection,
  rect: Rectangle,
  rank: number,
  count: number,
  used: readonly PlacedSegment[],
  gap: number,
  budget: WorkBudget,
): ConnectionPath | undefined {
  const { from, to } = connection;
  const xs = tracks(
    rect.left,
    rect.right,
    rect.left + ((rect.right - rect.left) * (rank + 1)) / (count + 1),
    [from.x, to.x, ...used.flatMap(({ from, to }) => [from.x, to.x])],
    gap,
  );
  const ys = tracks(
    rect.top,
    rect.bottom,
    rect.top + ((rect.bottom - rect.top) * (rank + 1)) / (count + 1),
    [from.y, to.y, ...used.flatMap(({ from, to }) => [from.y, to.y])],
    gap,
  );
  let best: ConnectionPath | undefined;
  const consider = (points: readonly Point[]) => {
    if (!spend(budget)) return;
    const result = compact(points);
    const resultCost = connectorCost(result, connection, rect, used, gap, budget);
    if (resultCost && (!best || resultCost.cost + resultCost.compression / 4 < best.cost + best.compression / 4)) {
      best = { points: result, ...resultCost, gap };
    }
  };
  if (from.x === to.x || from.y === to.y) consider([from, to]);
  consider([from, { x: from.x, y: to.y }, to]);
  consider([from, { x: to.x, y: from.y }, to]);
  if (best && best.compression === 0 && best.points.length <= 3 && best.cost < CROSSING_COST) return best;
  if (connection.entry.axis === connection.exit.axis) {
    for (const coordinate of connection.entry.axis === "y" ? xs : ys) {
      if (budget.exhausted) break;
      consider(
        connection.entry.axis === "y"
          ? [from, { x: coordinate, y: from.y }, { x: coordinate, y: to.y }, to]
          : [from, { x: from.x, y: coordinate }, { x: to.x, y: coordinate }, to],
      );
    }
  } else {
    for (const x of xs.slice(0, 8)) {
      for (const y of ys.slice(0, 8)) {
        if (budget.exhausted) break;
        consider(
          connection.entry.axis === "y"
            ? [from, { x, y: from.y }, { x, y }, { x: to.x, y }, to]
            : [from, { x: from.x, y }, { x, y }, { x, y: to.y }, to],
        );
      }
    }
  }
  if (best || budget.exhausted) return best;
  return searchConnector(
    connection,
    rect,
    [...new Set([from.x, to.x, ...xs])],
    [...new Set([from.y, to.y, ...ys])],
    used,
    gap,
    budget,
  );
}

function connectCell(
  connection: Connection,
  rect: Rectangle,
  rank: number,
  count: number,
  used: readonly PlacedSegment[],
  budget: WorkBudget,
): ConnectionPath | undefined {
  for (let gap = TRACK_GAP; gap >= MIN_GAP && !budget.exhausted; gap /= 2) {
    const limit = Math.min(budget.remaining, gap === MIN_GAP ? MAX_CELL_ATTEMPT_WORK : MAX_CELL_ATTEMPT_WORK / 16);
    if (!limit) {
      budget.exhausted = true;
      break;
    }
    const attempt: WorkBudget = { remaining: limit, exhausted: false };
    const result = connectCellAtGap(connection, rect, rank, count, used, gap, attempt);
    budget.remaining -= limit - attempt.remaining;
    if (result) return result;
  }
}

function boundaryPosition(point: Point, rect: Rectangle): number {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (Math.abs(point.y - rect.top) <= EPSILON) return point.x - rect.left;
  if (Math.abs(point.x - rect.right) <= EPSILON) return width + point.y - rect.top;
  if (Math.abs(point.y - rect.bottom) <= EPSILON) return width + height + rect.right - point.x;
  return width * 2 + height + rect.bottom - point.y;
}

function hullIntrudes(points: readonly Point[], rect: Rectangle): boolean {
  const corners: Point[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (length > EPSILON) axes.push({ x: (point.y - next.y) / length, y: (next.x - point.x) / length });
  });
  for (const axis of axes) {
    const project = (point: Point) => point.x * axis.x + point.y * axis.y;
    const a = points.map(project);
    const b = corners.map(project);
    if (Math.max(...a) <= Math.min(...b) + EPSILON || Math.max(...b) <= Math.min(...a) + EPSILON) return false;
  }
  return true;
}

function onObstacleBoundary(point: Point, rect: Rectangle): boolean {
  return (
    ((Math.abs(point.x - rect.left) <= EPSILON || Math.abs(point.x - rect.right) <= EPSILON) &&
      point.y >= rect.top - EPSILON &&
      point.y <= rect.bottom + EPSILON) ||
    ((Math.abs(point.y - rect.top) <= EPSILON || Math.abs(point.y - rect.bottom) <= EPSILON) &&
      point.x >= rect.left - EPSILON &&
      point.x <= rect.right + EPSILON)
  );
}

function renderRoutingPath(points: readonly Point[], obstacles: readonly Rectangle[]): EdgeRoute | undefined {
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
  const route = compact(points);
  if (route.length < 2) return;
  for (const segment of segments(route)) {
    if (segment.from.x !== segment.to.x && segment.from.y !== segment.to.y) return;
    if (obstacles.some((obstacle) => crossesObstacle(segment.from, segment.to, obstacle))) return;
  }
  const tip = route.at(-1)!;
  const previous = route.at(-2)!;
  const dx = Math.sign(tip.x - previous.x);
  const dy = Math.sign(tip.y - previous.y);
  const arrow: Rectangle = dx
    ? {
        left: Math.min(tip.x, tip.x - dx * 20),
        right: Math.max(tip.x, tip.x - dx * 20),
        top: tip.y - 10,
        bottom: tip.y + 10,
      }
    : {
        left: tip.x - 10,
        right: tip.x + 10,
        top: Math.min(tip.y, tip.y - dy * 20),
        bottom: Math.max(tip.y, tip.y - dy * 20),
      };
  // The marker box may overlap an attached endpoint across a narrow gap; only foreign obstacles hide the arrow.
  const start = route.at(0)!;
  if (
    obstacles.some(
      (obstacle) =>
        !onObstacleBoundary(start, obstacle) &&
        !onObstacleBoundary(tip, obstacle) &&
        Math.min(arrow.right, obstacle.right) > Math.max(arrow.left, obstacle.left) + EPSILON &&
        Math.min(arrow.bottom, obstacle.bottom) > Math.max(arrow.top, obstacle.top) + EPSILON,
    )
  )
    return;
  const commands = [`M ${route.at(0)!.x} ${route.at(0)!.y}`];
  for (let index = 1; index < route.length - 1; index += 1) {
    const before = route[index - 1]!;
    const corner = route[index]!;
    const after = route.at(index + 1)!;
    const incoming = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y);
    const outgoing = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y);
    let radius = Math.min(96, incoming / 2, outgoing / 2);
    if ((before.x === corner.x && corner.x === after.x) || (before.y === corner.y && corner.y === after.y)) radius = 0;
    let first = corner;
    let last = corner;
    for (let attempt = 0; attempt < 5 && radius > EPSILON; attempt += 1) {
      first = {
        x: corner.x + ((before.x - corner.x) * radius) / incoming,
        y: corner.y + ((before.y - corner.y) * radius) / incoming,
      };
      last = {
        x: corner.x + ((after.x - corner.x) * radius) / outgoing,
        y: corner.y + ((after.y - corner.y) * radius) / outgoing,
      };
      if (!obstacles.some((obstacle) => hullIntrudes([first, corner, last], obstacle))) break;
      radius = attempt === 4 ? 0 : radius / 2;
    }
    if (radius > EPSILON) commands.push(`L ${first.x} ${first.y} Q ${corner.x} ${corner.y} ${last.x} ${last.y}`);
    else commands.push(`L ${corner.x} ${corner.y}`);
  }
  commands.push(`L ${tip.x} ${tip.y}`);
  return { path: commands.join(" "), labelPosition: midpoint(route) };
}

function placeRoutes(
  scene: RoutingScene,
  plan: RoutingPlan,
  queries: ReadonlyMap<string, ReturnType<typeof createRoutingQuery>>,
  budget: WorkBudget,
  departureAnchors?: ReadonlyMap<string, number>,
): { paths: ReadonlyMap<string, readonly Point[]>; cost: number; compression: number } {
  const paths = new Map<string, readonly Point[]>();
  const coordinates = assignSlots(plan, budget, departureAnchors);
  if (!coordinates) return { paths, cost: 0, compression: 0 };
  const cells = new Map<number, Connection[]>();
  const connections = new Map<string, Map<number, ConnectionPath>>();
  const placed: PlacedSegment[] = [];
  for (const [edgeId, candidate] of plan.selected) {
    const values = coordinates.get(edgeId)!;
    candidate.cells.forEach((cell, index) => {
      const entries = cells.get(cell) ?? [];
      const entry = candidate.resources[index]!;
      const exit = candidate.resources.at(index + 1)!;
      entries.push({
        edgeId,
        cell,
        index,
        from: resourcePoint(entry, values[index]!),
        to: resourcePoint(exit, values.at(index + 1)!),
        entry,
        exit,
      });
      cells.set(cell, entries);
    });
  }
  for (const [cell, entries] of [...cells].sort(([a], [b]) => a - b)) {
    if (!spend(budget, entries.length)) break;
    const rect = scene.cells[cell]!.rect;
    const perimeter = 2 * (rect.right - rect.left + rect.bottom - rect.top);
    const span = (connection: Connection) => {
      const distance = Math.abs(boundaryPosition(connection.from, rect) - boundaryPosition(connection.to, rect));
      return Math.min(distance, perimeter - distance);
    };
    const straight = ({ from, to }: Connection) => from.x === to.x || from.y === to.y;
    entries.sort(
      (a, b) => Number(straight(b)) - Number(straight(a)) || span(a) - span(b) || a.edgeId.localeCompare(b.edgeId),
    );
    const nearby: PlacedSegment[] = [];
    for (const segment of placed) {
      if (!spend(budget)) break;
      if (
        Math.max(segment.from.x, segment.to.x) >= rect.left - TRACK_GAP &&
        Math.min(segment.from.x, segment.to.x) <= rect.right + TRACK_GAP &&
        Math.max(segment.from.y, segment.to.y) >= rect.top - TRACK_GAP &&
        Math.min(segment.from.y, segment.to.y) <= rect.bottom + TRACK_GAP
      )
        nearby.push(segment);
    }
    if (budget.exhausted) break;
    for (let rank = 0; rank < entries.length; rank += 1) {
      const connection = entries[rank]!;
      const used = nearby.filter(({ edgeId }) => edgeId !== connection.edgeId);
      const result = connectCell(connection, rect, rank, entries.length, used, budget);
      if (!result) continue;
      const route = connections.get(connection.edgeId) ?? new Map<number, ConnectionPath>();
      route.set(connection.index, result);
      connections.set(connection.edgeId, route);
      const added = segments(result.points).map((segment) => ({
        ...segment,
        edgeId: connection.edgeId,
        cell,
        gap: result.gap,
      }));
      placed.push(...added);
      nearby.push(...added);
    }
  }
  let cost = 0;
  let compression = 0;
  const accepted: Array<{
    segments: readonly Segment[];
    sections: readonly PlacedSegment[];
  }> = [];
  for (const [edgeId, candidate] of [...plan.selected].sort(([a], [b]) => a.localeCompare(b))) {
    if (!spend(budget)) break;
    const pieces = connections.get(edgeId);
    const query = queries.get(edgeId);
    if (!pieces || pieces.size !== candidate.cells.length || !query) continue;
    const points = compact(candidate.cells.flatMap((_, index) => [...pieces.get(index)!.points]));
    const own = segments(points);
    const sections = candidate.cells.flatMap((cell, index) => {
      const piece = pieces.get(index)!;
      return segments(piece.points).map((segment) => ({ ...segment, edgeId, cell, gap: piece.gap }));
    });
    let valid = points.length > 1;
    for (const segment of own) {
      for (const obstacle of query.obstacles) {
        if (!spend(budget) || crossesObstacle(segment.from, segment.to, obstacle)) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
    if (!valid) continue;
    let crossings = 0;
    let pathCompression = 0;
    for (const previous of accepted) {
      if (!valid) break;
      for (const segment of own) {
        for (const prior of previous.segments) {
          if (!spend(budget)) {
            valid = false;
            break;
          }
          const relation = spacingInteraction(segment, prior);
          if (!relation.valid) {
            valid = false;
            break;
          }
          crossings += relation.crossing;
          pathCompression += relation.compression;
        }
        if (!valid) break;
      }
      // Keep each connector's relaxation local when rechecking the complete paths.
      for (const section of sections) {
        if (!valid) break;
        for (const prior of previous.sections) {
          if (!spend(budget)) {
            valid = false;
            break;
          }
          if (section.axis !== prior.axis) continue;
          if (!spacingInteraction(section, prior, Math.min(section.gap, prior.gap)).valid) {
            valid = false;
            break;
          }
        }
      }
    }
    if (!valid) continue;
    if (!renderRoutingPath(points, query.obstacles)) continue;
    accepted.push({ segments: own, sections });
    paths.set(edgeId, points);
    compression += pathCompression;
    cost += routeLength(points) + Math.max(0, points.length - 2) * BEND_COST + crossings * CROSSING_COST;
  }
  return { paths, cost, compression };
}

// A solved departure slot anchors the port where the goal's centre projects onto
// the face, but the connector then walks around occupied corridors and its first
// real track settles elsewhere — the port draws a jog on departure. Read that
// settled coordinate back out of the routed points so the next pass can re-solve
// the departure slots against where each route actually goes.
function departureAnchorsFrom(paths: ReadonlyMap<string, readonly Point[]>, plan: RoutingPlan): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const [edgeId, candidate] of plan.selected) {
    const side = candidate.resources.at(0)?.terminal?.side;
    const points = paths.get(edgeId);
    if (!side || !points || points.length < 2) continue;
    const outward = side === "bottom" || side === "top" ? "y" : "x";
    const along = side === "bottom" || side === "top" ? "x" : "y";
    // Consume the face-normal stub leaving the port, then the transverse run that
    // follows it; where that run settles is the coordinate the port should own.
    let cursor = 1;
    while (cursor < points.length && points[cursor]![along] === points[cursor - 1]![along]) cursor += 1;
    if (cursor >= points.length) continue;
    while (cursor < points.length && points[cursor]![outward] === points[cursor - 1]![outward]) cursor += 1;
    anchors.set(edgeId, points[cursor - 1]![along]);
  }
  return anchors;
}

function coordinateRoutingPlan(
  scene: RoutingScene,
  plan: RoutingPlan,
  queries: ReadonlyMap<string, ReturnType<typeof createRoutingQuery>>,
  budget: WorkBudget,
): { paths: ReadonlyMap<string, readonly Point[]>; cost: number; compression: number } {
  const first = placeRoutes(scene, plan, queries, budget);
  const anchors = departureAnchorsFrom(first.paths, plan);
  if (!anchors.size || budget.exhausted) return first;
  const second = placeRoutes(scene, plan, queries, budget, anchors);
  return second.paths.size >= first.paths.size ? second : first;
}

export type AggregateRoutingStage = "normal" | "detour" | "independent" | "direct";
type RoutingReason =
  | "routed"
  | "extended-detour"
  | "spacing-limit"
  | "search-limit"
  | "order-limit"
  | "coordinate-limit"
  | "scene-limit"
  | "no-path";
export type AggregateEdgeRoute = EdgeRoute &
  Readonly<{
    routing: Readonly<{ stage: AggregateRoutingStage; reason: RoutingReason }>;
  }>;
export type AggregateRoutingOptions = Readonly<{
  maxSearchSteps?: number;
  maxOrderSteps?: number;
  maxCoordinateSteps?: number;
  maxImprovementPasses?: number;
}>;

const scenes = new WeakMap<DiagramLayout, RoutingScene>();
const budget = (limit: number): WorkBudget => ({
  remaining: Math.max(0, Math.min(2_000_000, Number.isNaN(limit) ? 0 : Math.floor(limit))),
  exhausted: false,
});

function directRoute(edge: DependencyRoutingProjection, bounds: ReadonlyMap<string, Bounds>): EdgeRoute {
  const source = rectangle(getOrThrow(bounds.get(edge.sourceId), `Missing aggregate source: ${edge.sourceId}`));
  const target = rectangle(getOrThrow(bounds.get(edge.targetId), `Missing aggregate target: ${edge.targetId}`));
  const sourceSide = sideFacing(source, target);
  let targetSide = sideFacing(target, source);
  const a = center(source);
  const b = center(target);
  const start = portPoint(source, sourceSide, sourceSide === "top" || sourceSide === "bottom" ? a.x : a.y);
  let end = portPoint(target, targetSide, targetSide === "top" || targetSide === "bottom" ? b.x : b.y);
  if (start.x === end.x && start.y === end.y) {
    targetSide =
      targetSide === "right" ? "left" : targetSide === "left" ? "right" : targetSide === "top" ? "bottom" : "top";
    end = portPoint(target, targetSide, targetSide === "top" || targetSide === "bottom" ? b.x : b.y);
  }
  const bend = sourceSide === "top" || sourceSide === "bottom" ? { x: start.x, y: end.y } : { x: end.x, y: start.y };
  const points = compact([start, bend, end]);
  return {
    path: points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "),
    labelPosition: midpoint(points),
  };
}

export function routeAggregateDependencyEdges(
  projections: readonly DependencyRoutingProjection[],
  layout: DiagramLayout,
  options: AggregateRoutingOptions = {},
): ReadonlyMap<string, AggregateEdgeRoute> {
  if (!projections.length) return new Map();
  const edges = [...projections].sort((a, b) => a.id.localeCompare(b.id) || (a.id < b.id ? -1 : Number(a.id > b.id)));
  let scene = scenes.get(layout);
  const bounds = new Map(scene?.bounds ?? getDependencyElementBounds(layout));
  if (!scene) {
    for (const bundle of collectVirtualBundles(layout, bounds)?.values() ?? []) bounds.set(bundle.id, bundle);
  }
  // Even scene construction is optional: every relationship already has a visible route.
  const routes = new Map<string, AggregateEdgeRoute>(
    edges.map((edge) => [
      edge.id,
      { ...directRoute(edge, bounds), routing: { stage: "direct", reason: "scene-limit" } },
    ]),
  );
  if (!scene) {
    scene = buildRoutingScene(layout, bounds);
    if (!scene) return routes;
    scenes.set(layout, scene);
  }

  const searchLimit = options.maxSearchSteps ?? 250_000;
  const orderLimit = options.maxOrderSteps ?? 250_000;
  const coordinateLimit = options.maxCoordinateSteps ?? 500_000;
  const searchBudget = budget(searchLimit);
  let requests = collectRoutingRequests(scene, edges, searchBudget);
  const queries = new Map(requests.map(({ edge, query }) => [edge.id, query]));
  const independent = new Map<string, EdgeRoute>();
  const baselineLengths = new Map<string, number>();
  const preserveIndependent = (entries: readonly RoutingRequest[]) => {
    for (const request of entries) {
      if (independent.has(request.edge.id)) continue;
      for (const candidate of request.candidates) {
        const result = coordinateRoutingPlan(scene, independentPlan(candidate), queries, budget(100_000));
        const points = result.paths.get(request.edge.id);
        const route = points && renderRoutingPath(points, request.query.obstacles);
        if (!route) continue;
        independent.set(request.edge.id, route);
        baselineLengths.set(request.edge.id, routeLength(points!));
        break;
      }
    }
  };
  preserveIndependent(requests);

  const evaluate = (plan: RoutingPlan, work: WorkBudget, extended = false) => {
    const result = coordinateRoutingPlan(scene, plan, queries, work);
    const rendered = new Map<string, EdgeRoute>();
    const polylines = new Map<string, readonly Segment[]>();
    let bends = 0;
    for (const [id, points] of result.paths) {
      const reference = baselineLengths.get(id);
      if (
        reference !== undefined &&
        routeLength(points) > reference + Math.max(extended ? 1_024 : 256, reference * (extended ? 1 : 0.25))
      )
        continue;
      const route = renderRoutingPath(points, queries.get(id)!.obstacles);
      if (route) {
        rendered.set(id, route);
        polylines.set(id, segments(points));
        bends += Math.max(0, points.length - 2);
      }
    }
    // Realized crossings between rendered routes — the ordering stage only estimates
    // them, so refinement must compare what actually got drawn.
    const placed = [...polylines.keys()];
    let crossings = 0;
    for (let index = 0; index < placed.length; index += 1) {
      for (const other of placed.slice(index + 1)) {
        for (const segment of polylines.get(placed[index]!)!) {
          crossings += measureAggregateSegmentCongestion(segment, polylines.get(other)!).crossings;
        }
      }
    }
    return { plan, rendered, cost: result.cost, compression: result.compression, crossings, bends };
  };
  const orderBudget = budget(orderLimit);
  const coordinateBudget = budget(coordinateLimit);
  let selected = evaluate(selectRoutingPlan(scene, requests, orderBudget), coordinateBudget);
  // Straightness ranks between crossings and compression: a plan with fewer real
  // corners wins even when it packs the corridors slightly tighter, because every
  // avoidable stair or hook reads as a routing error on the canvas.
  const improves = (next: typeof selected, previous: typeof selected) =>
    [...previous.rendered.keys()].every((id) => next.rendered.has(id)) &&
    (next.rendered.size > previous.rendered.size ||
      (next.rendered.size === previous.rendered.size &&
        (next.crossings < previous.crossings ||
          (next.crossings === previous.crossings &&
            (next.bends < previous.bends ||
              (next.bends === previous.bends &&
                (next.compression < previous.compression ||
                  (next.compression === previous.compression && next.cost < previous.cost))))))));
  const refine = (extended: boolean, ordering: WorkBudget, coordinates: WorkBudget) => {
    for (let pass = 0; pass < Math.min(4, options.maxImprovementPasses ?? 1); pass += 1) {
      let changed = false;
      const ordered = [...requests].sort(
        (a, b) => Number(selected.rendered.has(a.edge.id)) - Number(selected.rendered.has(b.edge.id)),
      );
      for (const request of ordered) {
        for (const candidate of request.candidates) {
          if (ordering.exhausted || coordinates.exhausted) return;
          if (selected.plan.selected.get(request.edge.id) === candidate) continue;
          const preferred = new Map(selected.plan.selected);
          preferred.set(request.edge.id, candidate);
          const trial = evaluate(
            selectRoutingPlan(scene, requests, ordering, extended, preferred),
            coordinates,
            extended,
          );
          if (!improves(trial, selected)) continue;
          selected = trial;
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  refine(false, orderBudget, coordinateBudget);
  const normal = selected;
  let extendedOrder: WorkBudget | undefined;
  let extendedCoordinates: WorkBudget | undefined;
  if (selected.rendered.size < edges.length) {
    if (requests.some(({ candidates }) => !candidates.length) && searchBudget.exhausted) {
      const additional = collectRoutingRequests(scene, edges, budget(searchLimit * 2));
      requests = requests.map((request, index) => (request.candidates.length ? request : additional[index]!));
      preserveIndependent(requests);
    }
    extendedOrder = budget(orderLimit * 2);
    extendedCoordinates = budget(coordinateLimit * 2);
    const trial = evaluate(selectRoutingPlan(scene, requests, extendedOrder, true), extendedCoordinates, true);
    if (improves(trial, selected)) selected = trial;
    refine(true, extendedOrder, extendedCoordinates);
  }

  for (const edge of edges) {
    const complete = selected.rendered.get(edge.id);
    if (complete) {
      const extended = normal.rendered.get(edge.id)?.path !== complete.path;
      routes.set(edge.id, {
        ...complete,
        routing: extended ? { stage: "detour", reason: "extended-detour" } : { stage: "normal", reason: "routed" },
      });
      continue;
    }
    const reason: RoutingReason = !requests.find(({ edge: entry }) => entry.id === edge.id)?.candidates.length
      ? searchBudget.exhausted
        ? "search-limit"
        : "no-path"
      : orderBudget.exhausted || extendedOrder?.exhausted
        ? "order-limit"
        : coordinateBudget.exhausted || extendedCoordinates?.exhausted
          ? "coordinate-limit"
          : "spacing-limit";
    const fallback = independent.get(edge.id);
    routes.set(edge.id, {
      ...(fallback ?? routes.get(edge.id)!),
      routing: { stage: fallback ? "independent" : "direct", reason },
    });
  }
  return routes;
}
