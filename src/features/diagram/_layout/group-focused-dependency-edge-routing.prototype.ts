import {
  routeDependencyEdges,
  type RoutedTopLevelDependencyEdge,
  type TopLevelDependencyRoutingEdge,
  type TopLevelDependencyRoutingModule,
} from "@/features/diagram/_layout/top-level-dependency-edge-routing.prototype";
import type { DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type GroupFocusedRoutingGroup = Readonly<{
  id: string;
  parentId?: string;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
}>;

export type GroupFocusedRoutingNode = Readonly<{
  id: string;
  groupId?: string;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
}>;

export type GroupFocusedDependencyRoutes = Readonly<{
  original: readonly RoutedTopLevelDependencyEdge[];
  aggregate: readonly RoutedTopLevelDependencyEdge[];
}>;

type RoutingScope = Readonly<{
  id?: string;
  bounds: Readonly<{
    position: DiagramLayoutPoint;
    size: DiagramLayoutSize;
  }>;
}>;

const ROOT_SCOPE_KEY = "root";
const GROUP_HEADER_HEIGHT = 56;
const GROUP_SCOPE_INSET = 4;
const ROOT_SCOPE_PADDING = 64;
const INTERNAL_EDGE_CLEARANCE = 32;
const AGGREGATE_EDGE_CLEARANCE = 32;

function isGroupWithin(
  groupId: string,
  ancestorId: string,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): boolean {
  let currentId: string | undefined = groupId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = getOrThrow(groupById.get(currentId), `Missing routing group: ${currentId}`).parentId;
  }
  return false;
}

function getGroupPath(
  groupId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): readonly string[] {
  const path: string[] = [];
  let currentId = groupId;
  while (currentId) {
    path.push(currentId);
    currentId = getOrThrow(groupById.get(currentId), `Missing routing group: ${currentId}`).parentId;
  }
  return path;
}

function getLowestCommonGroupId(
  firstGroupId: string | undefined,
  secondGroupId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): string | undefined {
  const firstPath = new Set(getGroupPath(firstGroupId, groupById));
  return getGroupPath(secondGroupId, groupById).find((groupId) => firstPath.has(groupId));
}

function getScopeBounds(group: GroupFocusedRoutingGroup): RoutingScope["bounds"] {
  return {
    position: {
      x: group.position.x + GROUP_SCOPE_INSET,
      y: group.position.y + GROUP_SCOPE_INSET,
    },
    size: {
      width: group.size.width - GROUP_SCOPE_INSET * 2,
      height: group.size.height - GROUP_SCOPE_INSET * 2,
    },
  };
}

function getRootScope(
  groups: readonly GroupFocusedRoutingGroup[],
  nodes: readonly GroupFocusedRoutingNode[],
): RoutingScope {
  const modules = [...groups.filter(({ parentId }) => !parentId), ...nodes.filter(({ groupId }) => !groupId)];
  const left = Math.min(...modules.map(({ position }) => position.x));
  const top = Math.min(...modules.map(({ position }) => position.y));
  const right = Math.max(...modules.map(({ position, size }) => position.x + size.width));
  const bottom = Math.max(...modules.map(({ position, size }) => position.y + size.height));
  return {
    bounds: {
      position: { x: left - ROOT_SCOPE_PADDING, y: top - ROOT_SCOPE_PADDING },
      size: {
        width: right - left + ROOT_SCOPE_PADDING * 2,
        height: bottom - top + ROOT_SCOPE_PADDING * 2,
      },
    },
  };
}

function getGroupsInScope(
  groups: readonly GroupFocusedRoutingGroup[],
  scopeId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): readonly GroupFocusedRoutingGroup[] {
  return scopeId ? groups.filter(({ id }) => isGroupWithin(id, scopeId, groupById)) : groups;
}

function getNodesInScope(
  nodes: readonly GroupFocusedRoutingNode[],
  scopeId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): readonly GroupFocusedRoutingNode[] {
  return scopeId ? nodes.filter(({ groupId }) => groupId && isGroupWithin(groupId, scopeId, groupById)) : nodes;
}

function getAllowedGroupIds(
  firstGroupId: string | undefined,
  secondGroupId: string | undefined,
  scopeId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const groupId of [firstGroupId, secondGroupId]) {
    for (const ancestorId of getGroupPath(groupId, groupById)) {
      allowed.add(ancestorId);
      if (ancestorId === scopeId) break;
    }
  }
  return allowed;
}

function isInsideEndpointGroup(
  groupId: string,
  endpointGroupIds: ReadonlySet<string>,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): boolean {
  return [...endpointGroupIds].some((endpointGroupId) => isGroupWithin(groupId, endpointGroupId, groupById));
}

function getGroupObstacles(
  groups: readonly GroupFocusedRoutingGroup[],
  allowedGroupIds: ReadonlySet<string>,
  endpointGroupIds: ReadonlySet<string>,
  scopeId: string | undefined,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): readonly TopLevelDependencyRoutingModule[] {
  const obstacles: TopLevelDependencyRoutingModule[] = [];

  for (const group of groups) {
    if (endpointGroupIds.has(group.id) || isInsideEndpointGroup(group.id, endpointGroupIds, groupById)) continue;
    if (allowedGroupIds.has(group.id)) {
      obstacles.push({
        id: `routing-header:${group.id}`,
        position: group.position,
        size: {
          width: group.size.width,
          height: Math.min(GROUP_HEADER_HEIGHT, group.size.height),
        },
      });
      continue;
    }

    const parentIsAllowed = group.parentId ? allowedGroupIds.has(group.parentId) : scopeId === undefined;
    if (parentIsAllowed) {
      obstacles.push({
        id: `routing-group:${group.id}`,
        position: group.position,
        size: group.size,
      });
    }
  }

  return obstacles;
}

function getModuleGroupId(
  moduleId: string,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
  nodeById: ReadonlyMap<string, GroupFocusedRoutingNode>,
): string | undefined {
  if (groupById.has(moduleId)) return moduleId;
  return getOrThrow(nodeById.get(moduleId), `Missing routing module: ${moduleId}`).groupId;
}

function getEndpointGroupIds(
  edge: TopLevelDependencyRoutingEdge,
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
): ReadonlySet<string> {
  return new Set([edge.source, edge.target].filter((moduleId) => groupById.has(moduleId)));
}

function rectanglesOverlap(first: TopLevelDependencyRoutingModule, second: TopLevelDependencyRoutingModule): boolean {
  return !(
    first.position.x + first.size.width <= second.position.x ||
    second.position.x + second.size.width <= first.position.x ||
    first.position.y + first.size.height <= second.position.y ||
    second.position.y + second.size.height <= first.position.y
  );
}

function routeOriginalEdges(
  groups: readonly GroupFocusedRoutingGroup[],
  nodes: readonly GroupFocusedRoutingNode[],
  edges: readonly TopLevelDependencyRoutingEdge[],
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
  nodeById: ReadonlyMap<string, GroupFocusedRoutingNode>,
): readonly RoutedTopLevelDependencyEdge[] {
  const rootScope = getRootScope(groups, nodes);
  const edgesByScope = new Map<string, TopLevelDependencyRoutingEdge[]>();

  for (const edge of edges) {
    const source = getOrThrow(nodeById.get(edge.source), `Missing original edge source: ${edge.source}`);
    const target = getOrThrow(nodeById.get(edge.target), `Missing original edge target: ${edge.target}`);
    const scopeId = getLowestCommonGroupId(source.groupId, target.groupId, groupById);
    const scopeKey = scopeId ?? ROOT_SCOPE_KEY;
    const scopedEdges = edgesByScope.get(scopeKey) ?? [];
    scopedEdges.push(edge);
    edgesByScope.set(scopeKey, scopedEdges);
  }

  const routeById = new Map<string, RoutedTopLevelDependencyEdge>();
  for (const [scopeKey, scopedEdges] of edgesByScope) {
    const scopeId = scopeKey === ROOT_SCOPE_KEY ? undefined : scopeKey;
    const scope = scopeId
      ? {
          id: scopeId,
          bounds: getScopeBounds(getOrThrow(groupById.get(scopeId), `Missing routing scope: ${scopeId}`)),
        }
      : rootScope;
    const scopeGroups = getGroupsInScope(groups, scope.id, groupById);
    const scopeNodes = getNodesInScope(nodes, scope.id, groupById);
    const routes = routeDependencyEdges(scopeNodes, scopedEdges, {
      bounds: scope.bounds,
      clearance: INTERNAL_EDGE_CLEARANCE,
      trackGap: 8,
      trackCount: 1,
      getObstacles: (edge) => {
        const source = getOrThrow(nodeById.get(edge.source), `Missing original edge source: ${edge.source}`);
        const target = getOrThrow(nodeById.get(edge.target), `Missing original edge target: ${edge.target}`);
        const allowedGroupIds = getAllowedGroupIds(source.groupId, target.groupId, scope.id, groupById);
        const nodeObstacles = scopeNodes.filter((node) =>
          node.groupId ? allowedGroupIds.has(node.groupId) : scope.id === undefined,
        );
        return [...nodeObstacles, ...getGroupObstacles(scopeGroups, allowedGroupIds, new Set(), scope.id, groupById)];
      },
    });
    routes.forEach((route) => routeById.set(route.id, route));
  }

  return edges.map(({ id }) => getOrThrow(routeById.get(id), `Missing original dependency route: ${id}`));
}

function routeAggregateEdges(
  groups: readonly GroupFocusedRoutingGroup[],
  nodes: readonly GroupFocusedRoutingNode[],
  edges: readonly TopLevelDependencyRoutingEdge[],
  groupById: ReadonlyMap<string, GroupFocusedRoutingGroup>,
  nodeById: ReadonlyMap<string, GroupFocusedRoutingNode>,
): readonly RoutedTopLevelDependencyEdge[] {
  const moduleById = new Map<string, TopLevelDependencyRoutingModule>([
    ...groups.map((group) => [group.id, group] as const),
    ...nodes.map((node) => [node.id, node] as const),
  ]);
  const rootScope = getRootScope(groups, nodes);
  const edgesByScope = new Map<string, TopLevelDependencyRoutingEdge[]>();
  const routableEdges = edges.filter((edge) => {
    const source = getOrThrow(moduleById.get(edge.source), `Missing aggregate edge source: ${edge.source}`);
    const target = getOrThrow(moduleById.get(edge.target), `Missing aggregate edge target: ${edge.target}`);
    if (rectanglesOverlap(source, target)) return false;
    const sourceGroupId = getModuleGroupId(edge.source, groupById, nodeById);
    const targetGroupId = getModuleGroupId(edge.target, groupById, nodeById);
    const scopeId = getLowestCommonGroupId(sourceGroupId, targetGroupId, groupById);
    const scopeKey = scopeId ?? ROOT_SCOPE_KEY;
    const scopedEdges = edgesByScope.get(scopeKey) ?? [];
    scopedEdges.push(edge);
    edgesByScope.set(scopeKey, scopedEdges);
    return true;
  });

  const routeById = new Map<string, RoutedTopLevelDependencyEdge>();
  for (const [scopeKey, scopedEdges] of edgesByScope) {
    const scopeId = scopeKey === ROOT_SCOPE_KEY ? undefined : scopeKey;
    const scope = scopeId
      ? {
          id: scopeId,
          bounds: getScopeBounds(getOrThrow(groupById.get(scopeId), `Missing routing scope: ${scopeId}`)),
        }
      : rootScope;
    const scopeGroups = getGroupsInScope(groups, scope.id, groupById);
    const scopeNodes = getNodesInScope(nodes, scope.id, groupById);
    const endpointModules = [...new Set(scopedEdges.flatMap(({ source, target }) => [source, target]))].map(
      (moduleId) => getOrThrow(moduleById.get(moduleId), `Missing aggregate module: ${moduleId}`),
    );
    const routes = routeDependencyEdges(endpointModules, scopedEdges, {
      bounds: scope.bounds,
      clearance: AGGREGATE_EDGE_CLEARANCE,
      trackGap: 12,
      trackCount: 2,
      getObstacles: (edge) => {
        const sourceGroupId = getModuleGroupId(edge.source, groupById, nodeById);
        const targetGroupId = getModuleGroupId(edge.target, groupById, nodeById);
        const allowedGroupIds = getAllowedGroupIds(sourceGroupId, targetGroupId, scope.id, groupById);
        const endpointGroupIds = getEndpointGroupIds(edge, groupById);
        const groupObstacles = getGroupObstacles(scopeGroups, allowedGroupIds, endpointGroupIds, scope.id, groupById);
        const nodeObstacles = scopeNodes.filter((node) => {
          if (node.id === edge.source || node.id === edge.target) return false;
          if (
            node.groupId &&
            [...endpointGroupIds].some((endpointGroupId) => isGroupWithin(node.groupId!, endpointGroupId, groupById))
          ) {
            return false;
          }
          return node.groupId ? allowedGroupIds.has(node.groupId) : scope.id === undefined;
        });
        return [...groupObstacles, ...nodeObstacles];
      },
    });
    routes.forEach((route) => routeById.set(route.id, route));
  }

  return routableEdges.map(({ id }) => getOrThrow(routeById.get(id), `Missing aggregate dependency route: ${id}`));
}

export function routeGroupFocusedDependencyEdges(
  groups: readonly GroupFocusedRoutingGroup[],
  nodes: readonly GroupFocusedRoutingNode[],
  originalEdges: readonly TopLevelDependencyRoutingEdge[],
  aggregateEdges: readonly TopLevelDependencyRoutingEdge[],
): GroupFocusedDependencyRoutes {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return {
    original: routeOriginalEdges(groups, nodes, originalEdges, groupById, nodeById),
    aggregate: routeAggregateEdges(groups, nodes, aggregateEdges, groupById, nodeById),
  };
}

export function routeNodeFocusedDependencyEdges(
  groups: readonly GroupFocusedRoutingGroup[],
  nodes: readonly GroupFocusedRoutingNode[],
  edges: readonly TopLevelDependencyRoutingEdge[],
): readonly RoutedTopLevelDependencyEdge[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return routeOriginalEdges(groups, nodes, edges, groupById, nodeById);
}
