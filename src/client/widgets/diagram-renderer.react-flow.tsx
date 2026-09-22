import { MarkerType, type Node, Position } from "@xyflow/react";
import { ExternalLink, FileCode2 } from "lucide-react";
import type { MouseEvent } from "react";

import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import {
  routeGroupFocusedDependencyEdges,
  routeNodeFocusedDependencyEdges,
} from "@/features/diagram/_layout/group-focused-dependency-edge-routing.prototype";
import { routeTopLevelDependencyEdges } from "@/features/diagram/_layout/top-level-dependency-edge-routing.prototype";
import {
  type DiagramDependencyEdgeProjection,
  type DiagramDependencyFocus,
  projectDiagramDependencyEdges,
} from "@/features/diagram/dependency-edge-projection";
import type { Diagram } from "@/features/diagram/diagram";
import type { DefaultDiagramNode, DiagramEdge, LifelineDiagramNode } from "@/features/diagram/diagram-graph";
import { getDiagramLinkLabel, isSourceLinkHref } from "@/features/diagram/diagram-link";
import type {
  DiagramLayout,
  DiagramLayoutNodeData,
  DiagramLayoutPoint,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";
import type { CardReactFlowNode } from "@/shared/react-flow/card-node";
import type { LabeledGroupReactFlowNode } from "@/shared/react-flow/labeled-group-node";
import type { LifelineReactFlowNode } from "@/shared/react-flow/lifeline-node";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type DiagramLinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
type DependencyBundleFocusHandler = (edgeIds: readonly string[]) => void;

function createDiagramLinkActivationHandler(onOpenSource: (href: string) => void): DiagramLinkActivationHandler {
  return (event, href) => {
    if (!isSourceLinkHref(href)) return;
    event.preventDefault();
    onOpenSource(href);
  };
}

const EDGE_COLOR = "var(--foreground)";
const INTERNAL_DEPENDENCY_EDGE_COLOR = "var(--muted-foreground)";
const DEFAULT_NODE_SIZE = { height: 144, width: 288 } as const;
const FRAGMENT_NODE_SIZE = { height: 160, width: 448 } as const;
const LIFELINE_NODE_SIZE = { height: 160, width: 224 } as const;
const AGGREGATE_EDGE_CORRIDOR_GAP = 96;
const AGGREGATE_EDGE_LANE_GAP = 10;
const AGGREGATE_EDGE_LANE_COUNT = 12;

export type DiagramReactFlowRenderModel = Readonly<{
  nodes: readonly DiagramReactFlowNode[];
  edges: readonly DiagramReactFlowEdge[];
}>;

function toCardNodeData(
  node: DefaultDiagramNode,
  onLinkActivate: DiagramLinkActivationHandler,
): CardReactFlowNode["data"] {
  return {
    label: node.title,
    ...(node.kind ? { eyebrow: node.kind } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.details ? { details: node.details } : {}),
    ...(node.links
      ? {
          links: node.links.map((link) => {
            const Icon = isSourceLinkHref(link.href) ? FileCode2 : ExternalLink;

            return {
              href: link.href,
              label: (
                <>
                  <Icon aria-hidden="true" data-icon="inline-start" />
                  <span className="min-w-0 truncate">Open {getDiagramLinkLabel(link)}</span>
                </>
              ),
            };
          }),
        }
      : {}),
    onLinkActivate,
  };
}

function toLifelineNodeData(
  node: LifelineDiagramNode,
  onLinkActivate: DiagramLinkActivationHandler,
  layout?: DiagramLayoutNodeData,
): LifelineReactFlowNode["data"] {
  return {
    node: {
      kind: node.kind,
      title: node.title,
      ...(node.description ? { description: node.description } : {}),
    },
    ...(node.links
      ? {
          links: node.links.map((link) => {
            const Icon = isSourceLinkHref(link.href) ? FileCode2 : ExternalLink;

            return {
              href: link.href,
              label: (
                <>
                  <Icon aria-hidden="true" data-icon="inline-start" />
                  <span className="min-w-0 truncate">Open {getDiagramLinkLabel(link)}</span>
                </>
              ),
            };
          }),
        }
      : {}),
    onLinkActivate,
    ...(layout ? { layout } : {}),
  };
}

export function buildDiagramMeasurementNodes(
  diagram: Diagram,
  onOpenSource: (href: string) => void,
): DiagramReactFlowNode[] {
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);

  return diagram.graph.nodes.map((node): DiagramReactFlowNode => {
    const common = {
      id: node.id,
      position: { x: 0, y: 0 },
      draggable: false,
      focusable: false,
      selectable: false,
    } as const;

    if (node.type === "default") {
      return {
        ...common,
        type: "card",
        data: toCardNodeData(node, onLinkActivate),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { opacity: 0, pointerEvents: "none" },
      };
    }

    if (node.type === "lifeline") {
      return {
        ...common,
        type: "lifeline",
        data: toLifelineNodeData(node, onLinkActivate),
        style: {
          opacity: 0,
          pointerEvents: "none",
          width: LIFELINE_NODE_SIZE.width,
        },
      };
    }

    return {
      ...common,
      type: "fragment",
      data: {
        node: {
          operator: node.operator,
          branches: node.branches.map(({ id, guard }) => ({ id, guard })),
        },
      },
      style: {
        opacity: 0,
        pointerEvents: "none",
        width: FRAGMENT_NODE_SIZE.width,
        height: FRAGMENT_NODE_SIZE.height,
      },
    };
  });
}

export function resolveDiagramNodeSizes(
  diagram: Diagram,
  nodes: readonly Pick<Node, "id" | "measured" | "type">[],
): DiagramNodeSizes {
  const measuredNodeSizes = Object.fromEntries(
    nodes.map((node) => {
      if (node.measured?.width && node.measured.height) {
        return [node.id, { height: node.measured.height, width: node.measured.width }];
      }
      if (node.type === "lifeline") return [node.id, LIFELINE_NODE_SIZE];
      if (node.type === "fragment") return [node.id, FRAGMENT_NODE_SIZE];
      return [node.id, DEFAULT_NODE_SIZE];
    }),
  );
  const missingNode = diagram.graph.nodes.find(({ id }) => !measuredNodeSizes[id]);
  if (missingNode) throw new Error(`React Flow did not measure diagram node: ${missingNode.id}`);

  return measuredNodeSizes;
}

function buildOriginalReactFlowEdge(
  edge: DiagramEdge,
  placement: DiagramLayout["edges"][number],
  onLinkActivate: DiagramLinkActivationHandler,
  presentation?: Readonly<{
    color?: string;
    cornerRadius?: number;
    curved?: boolean;
    strokeWidth?: number;
  }>,
): DiagramReactFlowEdge {
  const color = presentation?.color ?? EDGE_COLOR;
  const common = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    focusable: false,
    selectable: false,
    markerEnd: {
      type: edge.type === "default" || edge.messageType === "sync" ? MarkerType.ArrowClosed : MarkerType.Arrow,
      color,
    },
    style: {
      stroke: color,
      strokeWidth: presentation?.strokeWidth ?? 2,
      ...(edge.type === "message" && edge.messageType === "return" ? { strokeDasharray: "6 4" } : {}),
    },
  } as const;

  if (edge.type === "default") {
    return {
      ...common,
      type: "polyline",
      ...(edge.label ? { label: edge.label } : {}),
      data: {
        points: placement.points,
        ...(presentation?.cornerRadius ? { cornerRadius: presentation.cornerRadius } : {}),
        ...(presentation?.curved ? { curved: true } : {}),
        ...(edge.kind && edge.kind !== "direct-render" ? { eyebrow: edge.kind } : {}),
        ...(edge.href ? { href: edge.href } : {}),
        onLinkActivate,
      },
    };
  }

  return {
    ...common,
    type: "message",
    sourceHandle: `${edge.id}:source`,
    targetHandle: `${edge.id}:target`,
    zIndex: 1,
    data: {
      edge: {
        source: edge.source,
        target: edge.target,
        ...(edge.kind ? { kind: edge.kind } : {}),
        ...(edge.label ? { label: edge.label } : {}),
        ...(edge.href ? { href: edge.href } : {}),
        messageType: edge.messageType,
      },
      points: placement.points,
      onLinkActivate,
    },
  };
}

type AbsoluteModulePlacement = Readonly<{
  position: DiagramLayoutPoint;
  size: Readonly<{ width: number; height: number }>;
}>;

function getAbsoluteModulePlacements(layout: DiagramLayout): ReadonlyMap<string, AbsoluteModulePlacement> {
  const groupById = new Map(layout.groups.map((group) => [group.id, group]));
  const absoluteGroupById = new Map<string, AbsoluteModulePlacement>();

  function resolveGroup(groupId: string): AbsoluteModulePlacement {
    const existing = absoluteGroupById.get(groupId);
    if (existing) return existing;
    const group = getOrThrow(groupById.get(groupId), `Missing layout group: ${groupId}`);
    const parentPosition = group.parentId ? resolveGroup(group.parentId).position : { x: 0, y: 0 };
    const absolute = {
      position: {
        x: parentPosition.x + group.position.x,
        y: parentPosition.y + group.position.y,
      },
      size: group.size,
    };
    absoluteGroupById.set(groupId, absolute);
    return absolute;
  }

  layout.groups.forEach(({ id }) => resolveGroup(id));
  const absoluteNodeById = new Map(
    layout.nodes.map((node) => {
      const parentPosition = node.parentId ? resolveGroup(node.parentId).position : { x: 0, y: 0 };
      return [
        node.id,
        {
          position: {
            x: parentPosition.x + node.position.x,
            y: parentPosition.y + node.position.y,
          },
          size: node.size,
        },
      ] as const;
    }),
  );

  return new Map([...absoluteGroupById, ...absoluteNodeById]);
}

function compactPoints(points: readonly DiagramLayoutPoint[]): readonly DiagramLayoutPoint[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function buildAggregateEdgePoints(
  source: AbsoluteModulePlacement,
  target: AbsoluteModulePlacement,
  canvasRight: number,
  index: number,
): readonly DiagramLayoutPoint[] {
  const sourcePoint = {
    x: source.position.x + source.size.width,
    y: source.position.y + source.size.height / 2,
  };
  const targetPoint = {
    x: target.position.x,
    y: target.position.y + target.size.height / 2,
  };
  const corridorX =
    canvasRight + AGGREGATE_EDGE_CORRIDOR_GAP + (index % AGGREGATE_EDGE_LANE_COUNT) * AGGREGATE_EDGE_LANE_GAP;
  return compactPoints([
    sourcePoint,
    { x: corridorX, y: sourcePoint.y },
    { x: corridorX, y: targetPoint.y },
    targetPoint,
  ]);
}

type AggregateDependencyEdgeProjection = Extract<DiagramDependencyEdgeProjection, { type: "aggregate" }>;
type OriginalDependencyEdgeProjection = Extract<DiagramDependencyEdgeProjection, { type: "original" }>;

function buildAggregateReactFlowEdge(
  projection: AggregateDependencyEdgeProjection,
  points: readonly DiagramLayoutPoint[],
  curved = false,
  onDependencyBundleFocus?: DependencyBundleFocusHandler,
): DiagramReactFlowEdge {
  return {
    id: projection.id,
    source: projection.source,
    target: projection.target,
    type: "polyline",
    label: `×${projection.count}`,
    focusable: false,
    selectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
    style: { stroke: EDGE_COLOR, strokeWidth: 2 },
    data: {
      points,
      ...(curved ? { curved: true } : {}),
      ...(onDependencyBundleFocus
        ? {
            labelAriaLabel: `Show ${projection.count} underlying ${
              projection.count === 1 ? "dependency" : "dependencies"
            }`,
            onLabelActivate: (event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onDependencyBundleFocus(projection.edgeIds);
            },
          }
        : {}),
    },
  };
}

export function buildDiagramReactFlowEdges(
  diagram: Diagram,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
  focus?: DiagramDependencyFocus,
  onDependencyBundleFocus?: DependencyBundleFocusHandler,
): readonly DiagramReactFlowEdge[] {
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edgeById = new Map(diagram.graph.edges.map((edge) => [edge.id, edge]));
  const placementByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const unknownPlacement = layout.edges.find(({ id }) => !edgeById.has(id));
  if (unknownPlacement) {
    throw new Error(`Layout result references an unknown diagram edge: ${unknownPlacement.id}`);
  }

  if (diagram.layout.id !== "prototype-group-rows") {
    return diagram.graph.edges.map((edge) =>
      buildOriginalReactFlowEdge(
        edge,
        getOrThrow(placementByEdgeId.get(edge.id), `Missing edge placement: ${edge.id}`),
        onLinkActivate,
      ),
    );
  }

  const modulePlacementById = getAbsoluteModulePlacements(layout);
  const projections = projectDiagramDependencyEdges(diagram.graph, focus);

  if (!focus) {
    const aggregateProjections = projections.map((projection) => {
      if (projection.type !== "aggregate") {
        throw new Error(`Top-level dependency projection must be aggregate: ${projection.edgeId}`);
      }
      return projection;
    });
    const topLevelModules = [
      ...diagram.graph.groups.filter(({ parentId }) => !parentId),
      ...diagram.graph.nodes.filter(({ groupId }) => !groupId),
    ].map(({ id }) => ({
      id,
      ...getOrThrow(modulePlacementById.get(id), `Missing top-level module: ${id}`),
    }));
    const routeById = new Map(
      routeTopLevelDependencyEdges(
        topLevelModules,
        aggregateProjections.map(({ id, source, target }) => ({ id, source, target })),
      ).map((route) => [route.id, route]),
    );

    return aggregateProjections.map((projection) =>
      buildAggregateReactFlowEdge(
        projection,
        getOrThrow(routeById.get(projection.id), `Missing aggregate edge route: ${projection.id}`).points,
        true,
        onDependencyBundleFocus,
      ),
    );
  }

  const canvasRight = Math.max(
    ...[...modulePlacementById.values()].map(({ position, size }) => position.x + size.width),
    0,
  );

  const routingGroups = diagram.graph.groups.map(({ id, parentId }) => ({
    id,
    ...(parentId ? { parentId } : {}),
    ...getOrThrow(modulePlacementById.get(id), `Missing routing group: ${id}`),
  }));
  const routingNodes = diagram.graph.nodes.map(({ id, groupId }) => ({
    id,
    ...(groupId ? { groupId } : {}),
    ...getOrThrow(modulePlacementById.get(id), `Missing routing node: ${id}`),
  }));

  if (focus.type === "group") {
    const originalProjections = projections.filter(
      (projection): projection is OriginalDependencyEdgeProjection => projection.type === "original",
    );
    const aggregateProjections = projections.filter(
      (projection): projection is AggregateDependencyEdgeProjection => projection.type === "aggregate",
    );
    const routes = routeGroupFocusedDependencyEdges(
      routingGroups,
      routingNodes,
      originalProjections.map(({ edgeId }) => {
        const edge = getOrThrow(edgeById.get(edgeId), `Missing projected edge: ${edgeId}`);
        return { id: edge.id, source: edge.source, target: edge.target };
      }),
      aggregateProjections.map(({ id, source, target }) => ({ id, source, target })),
    );
    const originalRouteById = new Map(routes.original.map((route) => [route.id, route]));
    const aggregateRouteById = new Map(routes.aggregate.map((route) => [route.id, route]));

    return projections.map((projection, index) => {
      if (projection.type === "original") {
        const edge = getOrThrow(edgeById.get(projection.edgeId), `Missing projected edge: ${projection.edgeId}`);
        const route = getOrThrow(originalRouteById.get(edge.id), `Missing original edge route: ${edge.id}`);
        return buildOriginalReactFlowEdge(edge, { id: edge.id, points: route.points }, onLinkActivate, {
          color: INTERNAL_DEPENDENCY_EDGE_COLOR,
          curved: true,
          strokeWidth: 1.5,
        });
      }

      const route = aggregateRouteById.get(projection.id);
      return buildAggregateReactFlowEdge(
        projection,
        route?.points ??
          buildAggregateEdgePoints(
            getOrThrow(modulePlacementById.get(projection.source), `Missing source module: ${projection.source}`),
            getOrThrow(modulePlacementById.get(projection.target), `Missing target module: ${projection.target}`),
            canvasRight,
            index,
          ),
        true,
        onDependencyBundleFocus,
      );
    });
  }

  const focusedEdges = projections.map((projection) => {
    if (projection.type !== "original") {
      throw new Error(`Focused dependency projection must be original: ${projection.id}`);
    }
    const edge = getOrThrow(edgeById.get(projection.edgeId), `Missing projected edge: ${projection.edgeId}`);
    return { id: edge.id, source: edge.source, target: edge.target };
  });
  const routeById = new Map(
    routeNodeFocusedDependencyEdges(routingGroups, routingNodes, focusedEdges).map((route) => [route.id, route]),
  );

  return projections.map((projection) => {
    if (projection.type !== "original") {
      throw new Error(`Focused dependency projection must be original: ${projection.id}`);
    }
    const edge = getOrThrow(edgeById.get(projection.edgeId), `Missing projected edge: ${projection.edgeId}`);
    const route = getOrThrow(routeById.get(edge.id), `Missing focused edge route: ${edge.id}`);
    return buildOriginalReactFlowEdge(edge, { id: edge.id, points: route.points }, onLinkActivate, {
      curved: true,
    });
  });
}

export function buildDiagramReactFlowRenderModel(
  diagram: Diagram,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowRenderModel {
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const groups = layout.groups.map<LabeledGroupReactFlowNode>((placement) => {
    const group = diagram.graph.groups.find(({ id }) => id === placement.id);
    if (!group) throw new Error(`Layout result references an unknown diagram group: ${placement.id}`);

    return {
      id: group.id,
      type: "labeled-group",
      data: {
        label: group.title,
        ...(group.description ? { description: group.description } : {}),
      },
      position: placement.position,
      ...(placement.parentId ? { parentId: placement.parentId } : {}),
      style: { width: placement.size.width, height: placement.size.height },
      draggable: false,
      focusable: false,
      selectable: false,
    };
  });
  const nodes = layout.nodes.map<DiagramReactFlowNode>((placement) => {
    const node = diagram.graph.nodes.find(({ id }) => id === placement.id);
    if (!node) throw new Error(`Layout result references an unknown diagram node: ${placement.id}`);

    const common = {
      id: node.id,
      position: placement.position,
      ...(placement.parentId ? { parentId: placement.parentId } : {}),
      ...(placement.size ? { style: { width: placement.size.width, height: placement.size.height } } : {}),
      draggable: false,
      focusable: false,
      selectable: false,
    } as const;

    if (node.type === "default") {
      return {
        ...common,
        type: "card",
        data: toCardNodeData(node, onLinkActivate),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    }

    const layoutData = placement.data;
    if (node.type === "lifeline") {
      return {
        ...common,
        type: "lifeline",
        data: toLifelineNodeData(node, onLinkActivate, layoutData),
      };
    }

    return {
      ...common,
      type: "fragment",
      data: {
        node: {
          operator: node.operator,
          branches: node.branches.map(({ id, guard }) => ({ id, guard })),
        },
        ...(layoutData ? { layout: layoutData } : {}),
      },
    };
  });
  const edges = buildDiagramReactFlowEdges(diagram, layout, onOpenSource);

  return { nodes: [...groups, ...nodes], edges };
}
