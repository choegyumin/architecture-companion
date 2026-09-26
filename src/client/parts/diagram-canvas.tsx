import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodesChange,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Maximize } from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DIAGRAM_MIN_ZOOM, fitViewFraming } from "@/client/parts/diagram-canvas.viewport";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { DiagramLayoutPoint, DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";
import { BoundingGroupNode, type BoundingGroupReactFlowNode } from "@/shared/react-flow/bounding-group-node";
import { CardNode, type CardReactFlowNode } from "@/shared/react-flow/card-node";
import { FragmentNode, type FragmentReactFlowNode } from "@/shared/react-flow/fragment-node";
import { LabeledGroupNode, type LabeledGroupReactFlowNode } from "@/shared/react-flow/labeled-group-node";
import { LifelineNode, type LifelineReactFlowNode } from "@/shared/react-flow/lifeline-node";
import { MessageEdge, type MessageReactFlowEdge } from "@/shared/react-flow/message-edge";
import { RouteEdge, type RouteReactFlowEdge } from "@/shared/react-flow/route-edge";
import { useTheme } from "@/shared/react-ui/theme-context";

export type DiagramReactFlowNode =
  | CardReactFlowNode
  | LabeledGroupReactFlowNode
  | LifelineReactFlowNode
  | FragmentReactFlowNode
  | BoundingGroupReactFlowNode;
export type DiagramReactFlowEdge = RouteReactFlowEdge | MessageReactFlowEdge;

type NodeRendererRegistry<NodeType extends Node> = {
  [Type in Extract<NodeType["type"], string>]: ComponentType<NodeProps<Extract<NodeType, { type: Type }>>>;
};
type EdgeRendererRegistry<EdgeType extends Edge> = {
  [Type in Extract<EdgeType["type"], string>]: ComponentType<EdgeProps<Extract<EdgeType, { type: Type }>>>;
};

const diagramNodeTypes = {
  card: CardNode,
  "labeled-group": LabeledGroupNode,
  fragment: FragmentNode,
  lifeline: LifelineNode,
  "bounding-group": BoundingGroupNode,
} satisfies NodeRendererRegistry<DiagramReactFlowNode>;
const diagramEdgeTypes = {
  message: MessageEdge,
  route: RouteEdge,
} satisfies EdgeRendererRegistry<DiagramReactFlowEdge>;
const interactiveElementSelector =
  "a, button, form, input, select, textarea, [contenteditable='true'], [role='button']";
const isMacOS = navigator.userAgent.includes("Macintosh");

type DiagramCanvasProps = Readonly<{
  children?: ReactNode;
  className?: string;
  edges: DiagramReactFlowEdge[];
  nodes: DiagramReactFlowNode[];
  onCanvasClick?: (point: DiagramLayoutPoint, target?: AnnotationTarget) => void;
  onGroupActivate?: (groupId: string) => void;
  onNodeActivate?: (nodeId: string) => void;
  onPaneActivate?: () => void;
  onNodesChange?: OnNodesChange<DiagramReactFlowNode>;
  initialView?: DiagramViewFramingOptions;
}>;

export function DiagramCanvas({
  children,
  className,
  edges,
  nodes,
  onCanvasClick,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
  onNodesChange,
  initialView,
}: DiagramCanvasProps) {
  const { resolvedTheme } = useTheme();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<DiagramReactFlowNode, DiagramReactFlowEdge>>();
  const canvasRef = useRef<HTMLDivElement>(null);

  const fitView = useCallback(async () => {
    if (!flowInstance || !initialView || !canvasRef.current) return;
    await fitViewFraming(flowInstance, initialView, canvasRef.current);
  }, [flowInstance, initialView]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => void fitView());
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [fitView]);

  function isInteractiveClick(event: MouseEvent): boolean {
    return event.target instanceof Element && Boolean(event.target.closest(interactiveElementSelector));
  }

  function handleCanvasClick(event: MouseEvent, target?: AnnotationTarget): void {
    if (!onCanvasClick || !flowInstance || isInteractiveClick(event)) return;

    event.preventDefault();
    event.stopPropagation();
    const point = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onCanvasClick(point, target);
  }

  function handlePaneClick(event: MouseEvent): void {
    if (onCanvasClick) handleCanvasClick(event);
    else if (onPaneActivate && !isInteractiveClick(event)) onPaneActivate();
  }

  function handleNodeClick(event: MouseEvent, node: DiagramReactFlowNode): void {
    const clickedNode = event.target instanceof Element ? event.target.closest(".react-flow__node") : null;
    const clickedNodeId = clickedNode?.getAttribute("data-id");
    if (clickedNodeId && clickedNodeId !== node.id) return;
    // Bounding groups are decoration over the group: they have no element id to
    // activate or annotate, so clicks must not resolve to them.
    if (node.type === "bounding-group") return;
    if (onCanvasClick) {
      handleCanvasClick(event, { type: node.type === "labeled-group" ? "group" : "node", id: node.id });
    } else if (!isInteractiveClick(event)) {
      if (node.type === "card") onNodeActivate?.(node.id);
      if (node.type === "labeled-group") onGroupActivate?.(node.id);
    }
  }

  return (
    <div
      aria-label="Diagram canvas"
      className="h-full min-h-0"
      onClick={(event) => {
        if (event.target === event.currentTarget) handlePaneClick(event);
      }}
      ref={canvasRef}
      role="group"
    >
      <ReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>
        className={className}
        colorMode={resolvedTheme}
        style={{ "--xy-background-color": "var(--surface)" } as CSSProperties}
        edges={edges}
        edgesFocusable={false}
        edgeTypes={diagramEdgeTypes}
        elementsSelectable={false}
        minZoom={DIAGRAM_MIN_ZOOM}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        nodeTypes={diagramNodeTypes}
        onEdgeClick={(event, edge) => handleCanvasClick(event, { type: "edge", id: edge.id })}
        onInit={setFlowInstance}
        onNodeClick={handleNodeClick}
        onNodesChange={onNodesChange}
        onPaneClick={handlePaneClick}
        panOnDrag
        // WheelEvent cannot distinguish a trackpad from a mouse, so use macOS as the proxy.
        panOnScroll={isMacOS}
        zoomOnScroll={!isMacOS}
      >
        <Background />
        <Controls showFitView={false} showInteractive={false}>
          <ControlButton aria-label="Fit View" onClick={() => void fitView()} title="Fit View">
            <Maximize aria-hidden="true" />
          </ControlButton>
        </Controls>
        {children}
      </ReactFlow>
    </div>
  );
}
