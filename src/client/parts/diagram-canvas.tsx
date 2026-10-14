import { platform } from "@base-ui/utils/platform";
import {
  Background,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodesChange,
  ReactFlow,
  type ReactFlowInstance,
  useViewport,
} from "@xyflow/react";
import {
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";

import {
  DIAGRAM_MIN_ZOOM,
  type DiagramCameraFrame,
  fitViewFraming,
  focusBoundsFraming,
} from "@/client/parts/diagram-canvas.viewport";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { DiagramLayoutPoint, DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";
import { BoundingGroupNode, type BoundingGroupReactFlowNode } from "@/shared/react-flow/bounding-group-node";
import { ConnectionEdge, type ConnectionReactFlowEdge } from "@/shared/react-flow/connection-edge";
import { DiamondNode, type DiamondReactFlowNode } from "@/shared/react-flow/diamond-node";
import {
  defaultEdgeHighlight,
  EDGE_HIGHLIGHT_CLASS,
  type EdgeHighlightOrigin,
  resetEdgeHighlight,
  subscribeEdgeHighlight,
} from "@/shared/react-flow/edge-highlight";
import { FragmentNode, type FragmentReactFlowNode } from "@/shared/react-flow/fragment-node";
import { LabeledGroupNode, type LabeledGroupReactFlowNode } from "@/shared/react-flow/labeled-group-node";
import { LifelineNode, type LifelineReactFlowNode } from "@/shared/react-flow/lifeline-node";
import { RectangleNode, type RectangleReactFlowNode } from "@/shared/react-flow/rectangle-node";
import { useTheme } from "@/shared/react-ui/theme-context";

export type DiagramReactFlowNode =
  | RectangleReactFlowNode
  | LabeledGroupReactFlowNode
  | LifelineReactFlowNode
  | FragmentReactFlowNode
  | BoundingGroupReactFlowNode
  | DiamondReactFlowNode;
export type DiagramReactFlowEdge = ConnectionReactFlowEdge;

export type DiagramCameraControls = Readonly<{
  cameraReady: boolean;
  fitView: () => Promise<void>;
  focusNodes: (nodeIds: readonly string[]) => Promise<void>;
}>;

type NodeRendererRegistry<NodeType extends Node> = {
  [Type in Extract<NodeType["type"], string>]: ComponentType<NodeProps<Extract<NodeType, { type: Type }>>>;
};
type EdgeRendererRegistry<EdgeType extends Edge> = {
  [Type in Extract<EdgeType["type"], string>]: ComponentType<EdgeProps<Extract<EdgeType, { type: Type }>>>;
};

const diagramNodeTypes = {
  rectangle: RectangleNode,
  diamond: DiamondNode,
  "labeled-group": LabeledGroupNode,
  fragment: FragmentNode,
  lifeline: LifelineNode,
  "bounding-group": BoundingGroupNode,
} satisfies NodeRendererRegistry<DiagramReactFlowNode>;
const diagramEdgeTypes = {
  connection: ConnectionEdge,
} satisfies EdgeRendererRegistry<DiagramReactFlowEdge>;
const interactiveElementSelector =
  "a, button, form, input, select, textarea, [contenteditable='true'], [role='button']";

type DiagramCanvasProps = Readonly<{
  className?: string;
  edges: DiagramReactFlowEdge[];
  nodes: DiagramReactFlowNode[];
  renderOverlays?: (camera: DiagramCameraControls) => ReactNode;
  onCanvasClick?: (point: DiagramLayoutPoint, target?: AnnotationTarget) => void;
  onGroupActivate?: (groupId: string) => void;
  onNodeActivate?: (nodeId: string) => void;
  onPaneActivate?: () => void;
  onNodesChange?: OnNodesChange<DiagramReactFlowNode>;
  /**
   * Maps a highlight origin to the edges it lights. Unset defaults to the
   * origin's own route (node origins light nothing); a renderer that tracks
   * its own graph can widen the highlight to a whole path.
   */
  resolveEdgeHighlight?: (origin: EdgeHighlightOrigin) => ReadonlySet<string>;
  initialView?: DiagramViewFramingOptions;
  focusFrame?: DiagramCameraFrame;
  /** A new identity requests framing; projection styling alone must not recenter the camera. */
  focusRequestKey?: object;
  reserveRight?: number;
}>;

export function DiagramCanvas({
  className,
  edges,
  nodes,
  renderOverlays,
  onCanvasClick,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
  onNodesChange,
  resolveEdgeHighlight,
  initialView,
  focusFrame,
  focusRequestKey,
  reserveRight = 0,
}: DiagramCanvasProps) {
  const { resolvedTheme } = useTheme();
  const { zoom } = useViewport();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<DiagramReactFlowNode, DiagramReactFlowEdge>>();
  const [highlightOrigin, setHighlightOrigin] = useState<EdgeHighlightOrigin | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const isMacOS = platform.os.mac;

  // Labels report highlights through the module-level channel; the canvas
  // decides which edges light. Dropping the held origin on unmount keeps a
  // vanished label from lighting edges in the next mounted diagram.
  useEffect(() => {
    const unsubscribe = subscribeEdgeHighlight(setHighlightOrigin);
    return () => {
      unsubscribe();
      resetEdgeHighlight();
    };
  }, []);
  const highlightedEdges = useMemo(
    () =>
      highlightOrigin == null
        ? null
        : (resolveEdgeHighlight?.(highlightOrigin) ?? defaultEdgeHighlight(highlightOrigin)),
    [highlightOrigin, resolveEdgeHighlight],
  );
  const highlightStampedEdges = useMemo(() => {
    if (highlightedEdges == null || highlightedEdges.size === 0) return edges;
    return edges.map((edge) =>
      highlightedEdges.has(edge.id)
        ? {
            ...edge,
            className: edge.className == null ? EDGE_HIGHLIGHT_CLASS : `${edge.className} ${EDGE_HIGHLIGHT_CLASS}`,
          }
        : edge,
    );
  }, [edges, highlightedEdges]);

  const fitView = useCallback(async () => {
    if (!flowInstance || !initialView || !canvasElement) return;
    await fitViewFraming(flowInstance, initialView, canvasElement, reserveRight);
  }, [canvasElement, flowInstance, initialView, reserveRight]);
  const focusNodes = useCallback(
    async (nodeIds: readonly string[]) => {
      if (!flowInstance || !canvasElement || nodeIds.length === 0) return;
      const bounds = flowInstance.getNodesBounds([...nodeIds]);
      await focusBoundsFraming(flowInstance, bounds, canvasElement, reserveRight);
    },
    [canvasElement, flowInstance, reserveRight],
  );

  const frameRequestedView = useEffectEvent(() => {
    if (focusFrame?.mode === "nodes") void focusNodes(focusFrame.nodeIds);
    else if (focusFrame?.mode === "bounds" && flowInstance && canvasElement) {
      void focusBoundsFraming(flowInstance, focusFrame.bounds, canvasElement, reserveRight);
    } else void fitView();
  });
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(frameRequestedView);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [fitView, focusRequestKey]);

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
    // Unlabeled bounding groups are derived decoration, not graph elements.
    if (node.type === "bounding-group" && node.data.label == null) return;
    if (onCanvasClick) {
      handleCanvasClick(event, {
        type: node.type === "labeled-group" || node.type === "bounding-group" ? "group" : "node",
        id: node.id,
      });
    } else if (!isInteractiveClick(event)) {
      if (node.type === "rectangle" || node.type === "diamond") onNodeActivate?.(node.id);
      if (node.type === "labeled-group" || (node.type === "bounding-group" && node.data.label != null))
        onGroupActivate?.(node.id);
    }
  }

  return (
    <div
      aria-label="Artifact canvas"
      className="h-full min-h-0"
      onClick={(event) => {
        if (event.target === event.currentTarget) handlePaneClick(event);
      }}
      ref={setCanvasElement}
      role="group"
    >
      <ReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>
        className={className}
        colorMode={resolvedTheme}
        // The useViewport subscription re-renders this tree on every pan/zoom
        // frame — accepted so CSS can scale the search outlines with zoom.
        style={
          {
            "--xy-background-color": "var(--surface)",
            "--react-flow-viewport-zoom": zoom,
          } as CSSProperties
        }
        edges={highlightStampedEdges}
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
        {renderOverlays?.({ cameraReady: Boolean(flowInstance && canvasElement), fitView, focusNodes })}
      </ReactFlow>
    </div>
  );
}
