import { addEventListener } from "@base-ui/utils/addEventListener";
import { platform } from "@base-ui/utils/platform";
import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodesChange,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  useViewport,
} from "@xyflow/react";
import { Maximize } from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DIAGRAM_MIN_ZOOM,
  fitViewFraming,
  focusBoundsFraming,
  SPOTLIGHT_VIEWPORT_RESERVE,
} from "@/client/parts/diagram-canvas.viewport";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { DiagramLayoutPoint, DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";
import { cn } from "@/shared/react/class-name";
import { BoundingGroupNode, type BoundingGroupReactFlowNode } from "@/shared/react-flow/bounding-group-node";
import { CardNode, type CardReactFlowNode } from "@/shared/react-flow/card-node";
import { DecisionNode, type DecisionReactFlowNode } from "@/shared/react-flow/decision-node";
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
import { MessageEdge, type MessageReactFlowEdge } from "@/shared/react-flow/message-edge";
import { NodeSearch } from "@/shared/react-flow/node-search";
import { RouteEdge, type RouteReactFlowEdge } from "@/shared/react-flow/route-edge";
import { useTheme } from "@/shared/react-ui/theme-context";

export type DiagramReactFlowNode =
  | CardReactFlowNode
  | LabeledGroupReactFlowNode
  | LifelineReactFlowNode
  | FragmentReactFlowNode
  | BoundingGroupReactFlowNode
  | DecisionReactFlowNode;
export type DiagramReactFlowEdge = RouteReactFlowEdge | MessageReactFlowEdge;

type NodeRendererRegistry<NodeType extends Node> = {
  [Type in Extract<NodeType["type"], string>]: ComponentType<NodeProps<Extract<NodeType, { type: Type }>>>;
};
type EdgeRendererRegistry<EdgeType extends Edge> = {
  [Type in Extract<EdgeType["type"], string>]: ComponentType<EdgeProps<Extract<EdgeType, { type: Type }>>>;
};

const diagramNodeTypes = {
  card: CardNode,
  decision: DecisionNode,
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

export type DiagramFocusTarget =
  | Readonly<{ kind: "nodes"; nodeIds: readonly string[] }>
  | Readonly<{ kind: "bounds"; x: number; y: number; width: number; height: number }>;

export type DiagramFocusView = Readonly<{ key: string; target: DiagramFocusTarget }>;

type DiagramCanvasProps = Readonly<{
  children?: ReactNode;
  className?: string;
  edges: DiagramReactFlowEdge[];
  focusView?: DiagramFocusView;
  getNodeLabel?: (node: DiagramReactFlowNode) => string;
  nodes: DiagramReactFlowNode[];
  onCanvasClick?: (point: DiagramLayoutPoint, target?: AnnotationTarget) => void;
  onGroupActivate?: (groupId: string) => void;
  onNodeActivate?: (nodeId: string) => void;
  onPaneActivate?: () => void;
  onNodesChange?: OnNodesChange<DiagramReactFlowNode>;
  onSearchQueryChange?: (value: string) => void;
  /**
   * Maps a highlight origin to the edges it lights. Unset defaults to the
   * origin's own route (node origins light nothing); a renderer that tracks
   * its own graph can widen the highlight to a whole path.
   */
  resolveEdgeHighlight?: (origin: EdgeHighlightOrigin) => ReadonlySet<string>;
  searchQuery?: string;
  initialView?: DiagramViewFramingOptions;
}>;

export function DiagramCanvas({
  children,
  className,
  edges,
  focusView,
  getNodeLabel,
  nodes,
  onCanvasClick,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
  onNodesChange,
  onSearchQueryChange,
  resolveEdgeHighlight,
  searchQuery,
  initialView,
}: DiagramCanvasProps) {
  const { resolvedTheme } = useTheme();
  const { zoom } = useViewport();
  const [searchMatches, setSearchMatches] = useState<{ ids: ReadonlySet<string>; currentId: string | null }>({
    ids: new Set(),
    currentId: null,
  });
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<DiagramReactFlowNode, DiagramReactFlowEdge>>();
  const [highlightOrigin, setHighlightOrigin] = useState<EdgeHighlightOrigin | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMacOS = platform.os.mac;
  const searchEnabled = Boolean(flowInstance && getNodeLabel);

  useEffect(() => {
    if (!searchEnabled) return;
    return addEventListener(document, "keydown", (event) => {
      const modifierPressed = isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (
        !modifierPressed ||
        event.key.toLowerCase() !== "k" ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    });
  }, [isMacOS, searchEnabled]);

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

  const handleSearchMatchesChange = useCallback(
    (matches: readonly DiagramReactFlowNode[], currentNode: DiagramReactFlowNode | null) => {
      setSearchMatches({ ids: new Set(matches.map((node) => node.id)), currentId: currentNode?.id ?? null });
    },
    [],
  );
  const searchStampedNodes = useMemo(() => {
    if (!searchEnabled || searchMatches.ids.size === 0) return nodes;
    return nodes.map((node) =>
      searchMatches.ids.has(node.id)
        ? {
            ...node,
            className: cn(
              node.className,
              "is-search-match",
              node.id === searchMatches.currentId && "is-search-current",
            ),
          }
        : node,
    );
  }, [nodes, searchEnabled, searchMatches]);

  const fitView = useCallback(
    async (rightReserve = 0) => {
      if (!flowInstance || !initialView || !canvasRef.current) return;
      await fitViewFraming(flowInstance, initialView, canvasRef.current, rightReserve);
    },
    [flowInstance, initialView],
  );

  const latestFocusView = useRef(focusView);
  useEffect(() => {
    latestFocusView.current = focusView;
  }, [focusView]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        // A spotlight takes precedence over the pending initial fit. Read the
        // latest target without scheduling another fit when the spotlight closes.
        if (!latestFocusView.current) void fitView();
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [fitView]);

  const focusSpotlightView = useCallback(async () => {
    if (!flowInstance || !focusView || !canvasRef.current) return;
    if (focusView.target.kind === "bounds") {
      await focusBoundsFraming(flowInstance, focusView.target, canvasRef.current, SPOTLIGHT_VIEWPORT_RESERVE);
      return;
    }
    if (focusView.target.nodeIds.length > 0) {
      const framedNodes = focusView.target.nodeIds
        .map((id) => flowInstance.getInternalNode(id))
        .filter((node): node is NonNullable<typeof node> => node != null);
      const bounds = flowInstance.getNodesBounds(framedNodes);
      await focusBoundsFraming(flowInstance, bounds, canvasRef.current, SPOTLIGHT_VIEWPORT_RESERVE);
      return;
    }
    await fitView(SPOTLIGHT_VIEWPORT_RESERVE);
  }, [flowInstance, focusView, fitView]);

  useEffect(() => {
    if (!focusView) return;
    let frame = 0;
    let attempts = 0;

    // Framed nodes are unmeasured until React Flow's ResizeObserver runs, so a
    // spotlight present at mount would fit to nothing. Poll frames until the
    // framed nodes have dimensions (or give up) before fitting. Bounds
    // framings come from the layout directly and need no measurement. The
    // parent memoizes the focus view, so this effect only re-runs for a new
    // framing.
    const waitForFramedNodes = () => {
      attempts += 1;
      const framedReady =
        flowInstance !== undefined &&
        (focusView.target.kind === "bounds" ||
          focusView.target.nodeIds.length === 0 ||
          focusView.target.nodeIds.every((id) => (flowInstance.getInternalNode(id)?.measured.width ?? 0) > 0));
      if (!framedReady && attempts < 90) {
        frame = requestAnimationFrame(waitForFramedNodes);
        return;
      }
      void focusSpotlightView();
    };

    frame = requestAnimationFrame(waitForFramedNodes);
    return () => cancelAnimationFrame(frame);
  }, [focusView, focusSpotlightView, flowInstance]);

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

  function handleSearchSelect(node: DiagramReactFlowNode): void {
    if (!flowInstance || !canvasRef.current) return;
    if (node.type === "card") onNodeActivate?.(node.id);
    if (node.type === "labeled-group") onGroupActivate?.(node.id);
    const internalNode = flowInstance.getInternalNode(node.id);
    if (!internalNode) return;
    const bounds = flowInstance.getNodesBounds([internalNode]);
    void focusBoundsFraming(flowInstance, bounds, canvasRef.current, focusView ? SPOTLIGHT_VIEWPORT_RESERVE : 0);
  }

  return (
    <div
      aria-label="Artifact canvas"
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
        nodes={searchStampedNodes}
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
          <ControlButton
            aria-label="Fit View"
            onClick={() => void fitView(focusView ? SPOTLIGHT_VIEWPORT_RESERVE : 0)}
            title="Fit View"
          >
            <Maximize aria-hidden="true" />
          </ControlButton>
        </Controls>
        {searchEnabled ? (
          <Panel className="nodrag nopan nowheel" position="top-left">
            <NodeSearch<DiagramReactFlowNode>
              getNodeLabel={getNodeLabel}
              inputRef={searchInputRef}
              onSelectNode={handleSearchSelect}
              onMatchesChange={handleSearchMatchesChange}
              onSearchQueryChange={onSearchQueryChange}
              searchQuery={searchQuery}
              endInputAddon={
                <kbd className="rounded-sm border bg-muted px-1.5 py-0.5 text-xs">{isMacOS ? "⌘K" : "Ctrl+K"}</kbd>
              }
            />
          </Panel>
        ) : null}
        {children}
      </ReactFlow>
    </div>
  );
}
