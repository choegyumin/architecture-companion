import { MarkerType, type Node, Position } from "@xyflow/react";
import { ExternalLink, FileCode2 } from "lucide-react";
import type { MouseEvent } from "react";

import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import type { Diagram } from "@/features/diagram/diagram";
import type { DefaultDiagramNode, LifelineDiagramNode } from "@/features/diagram/diagram-graph";
import { getDiagramLinkLabel, isSourceLinkHref } from "@/features/diagram/diagram-link";
import type { DiagramLayout, DiagramLayoutNodeData, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import type { CardReactFlowNode } from "@/shared/react-flow/card-node";
import type { LabeledGroupReactFlowNode } from "@/shared/react-flow/labeled-group-node";
import type { LifelineReactFlowNode } from "@/shared/react-flow/lifeline-node";

type DiagramLinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

function createDiagramLinkActivationHandler(onOpenSource: (href: string) => void): DiagramLinkActivationHandler {
  return (event, href) => {
    if (!isSourceLinkHref(href)) return;
    event.preventDefault();
    onOpenSource(href);
  };
}

const EDGE_COLOR = "var(--foreground)";
const DEFAULT_NODE_SIZE = { height: 144, width: 288 } as const;
const FRAGMENT_NODE_SIZE = { height: 160, width: 448 } as const;
const LIFELINE_NODE_SIZE = { height: 160, width: 224 } as const;

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
    eyebrow: node.kind,
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
  const edges = layout.edges.map<DiagramReactFlowEdge>((placement) => {
    const edge = diagram.graph.edges.find(({ id }) => id === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);

    const common = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      focusable: false,
      selectable: false,
      markerEnd: {
        type: edge.type === "default" || edge.messageType === "sync" ? MarkerType.ArrowClosed : MarkerType.Arrow,
        color: EDGE_COLOR,
      },
      style: {
        stroke: EDGE_COLOR,
        strokeWidth: 2,
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
  });

  return { nodes: [...groups, ...nodes], edges };
}
