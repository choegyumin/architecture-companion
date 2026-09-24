import { ReactFlowProvider, useNodesState, useReactFlow } from "@xyflow/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { AnnotationLayer } from "@/client/parts/annotation-layer";
import { DiagramCanvas, type DiagramReactFlowEdge, type DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { DiagramLinksPanel } from "@/client/widgets/diagram-links-panel";
import {
  buildDiagramMeasurementNodes,
  type DiagramReactFlowRenderModel,
  resolveDiagramNodeSizes,
} from "@/client/widgets/diagram-renderer.react-flow";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { cn } from "@/shared/react/class-name";
import { BaseOverlayPanel } from "@/shared/react-flow/base-overlay-panel";

export type DiagramRendererProps = Readonly<{
  ariaLabel?: string;
  annotations: AnnotationCanvasController;
  diagram: Diagram;
  onOpenSource: (href: string) => void;
  commentEnabled?: boolean;
}>;

type DiagramRendererBaseProps = DiagramRendererProps &
  Readonly<{
    calculateLayout: (diagram: Diagram, nodeSizes: DiagramNodeSizes) => Promise<DiagramLayout>;
    buildRenderModel: (
      diagram: Diagram,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ) => DiagramReactFlowRenderModel;
    onGroupActivate?: (groupId: string) => void;
    onNodeActivate?: (nodeId: string) => void;
    onPaneActivate?: () => void;
  }>;

type DiagramLayoutState =
  | Readonly<{ status: "measuring" | "layouting" }>
  | Readonly<{
      status: "ready";
      layout: DiagramLayout;
    }>
  | Readonly<{ status: "error"; message: string }>;

type DiagramContentProps = DiagramRendererBaseProps & Readonly<{ ariaLabel: string }>;

function DiagramRendererContent({
  ariaLabel,
  annotations,
  diagram,
  onOpenSource,
  calculateLayout,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
}: DiagramContentProps) {
  const measurementNodes = useMemo(() => buildDiagramMeasurementNodes(diagram, onOpenSource), [diagram, onOpenSource]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramReactFlowNode>(measurementNodes);
  const [state, setState] = useState<DiagramLayoutState>({ status: "measuring" });
  const hasStartedLayout = useRef(false);
  const { getNodes } = useReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>();
  const latestLayoutInputs = useRef({ diagram, getNodes, calculateLayout });

  useEffect(() => {
    latestLayoutInputs.current = { diagram, getNodes, calculateLayout };
  }, [diagram, getNodes, calculateLayout]);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const runLayout = () => {
      if (cancelled || hasStartedLayout.current) return;
      hasStartedLayout.current = true;
      const { diagram, getNodes, calculateLayout } = latestLayoutInputs.current;
      let measuredNodeSizes: ReturnType<typeof resolveDiagramNodeSizes>;
      try {
        measuredNodeSizes = resolveDiagramNodeSizes(diagram, getNodes());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Diagram measurement failed.";
        setState({ status: "error", message });
        return;
      }

      setState({ status: "layouting" });
      void calculateLayout(diagram, measuredNodeSizes)
        .then((layout) => {
          if (!cancelled) setState({ status: "ready", layout });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Diagram layout failed.";
          if (!cancelled) setState({ status: "error", message });
        });
    };

    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(runLayout);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  const rendered = useMemo(() => {
    if (state.status !== "ready") return undefined;
    try {
      return { status: "ready", model: buildRenderModel(diagram, state.layout, onOpenSource) } as const;
    } catch (error: unknown) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Diagram rendering failed.",
      } as const;
    }
  }, [state, diagram, onOpenSource, buildRenderModel]);

  useLayoutEffect(() => {
    if (rendered?.status === "ready") setNodes([...rendered.model.nodes]);
  }, [rendered, setNodes]);

  return (
    <div aria-label={ariaLabel} className="relative h-full min-h-0 overflow-hidden bg-background" role="region">
      <ul aria-label="Diagram elements and connections" className="sr-only">
        {diagram.graph.nodes.map((node) => (
          <li key={node.id}>
            {node.kind}: {node.title}
          </li>
        ))}
        {diagram.graph.edges.map((edge) => (
          <li key={edge.id}>
            {edge.source} to {edge.target}
            {edge.label ? (
              <>
                {": "}
                <span>{edge.label}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <DiagramCanvas
        className={cn(annotations.isCommentMode && "[&_.react-flow__pane]:cursor-crosshair")}
        edges={rendered?.status === "ready" ? [...rendered.model.edges] : []}
        nodes={nodes}
        onCanvasClick={
          annotations.isCommentMode
            ? (point, target) => {
                const selected: AnnotationTarget | undefined =
                  target?.type === "edge" && rendered?.status === "ready"
                    ? (rendered.model.edgeTargets?.get(target.id) ?? target)
                    : target;
                annotations.begin({
                  ...annotations.surface,
                  ...(selected ? { target: selected } : {}),
                  point,
                });
              }
            : undefined
        }
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
        onPaneActivate={onPaneActivate}
        onNodesChange={onNodesChange}
        initialView={state.status === "ready" ? state.layout.initialView : undefined}
      >
        <BaseOverlayPanel>{(overlay) => <AnnotationLayer {...overlay} controller={annotations} />}</BaseOverlayPanel>
        <DiagramLinksPanel links={diagram.links ?? []} onOpenSource={onOpenSource} />
      </DiagramCanvas>
      {state.status === "measuring" || state.status === "layouting" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Laying out…
        </div>
      ) : null}
      {state.status === "error" || rendered?.status === "error" ? (
        <p
          className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-destructive"
          role="alert"
        >
          {state.status === "error" ? state.message : rendered?.status === "error" ? rendered.message : null}
        </p>
      ) : null}
    </div>
  );
}

export function DiagramRendererBase({
  ariaLabel,
  annotations,
  diagram,
  onOpenSource,
  calculateLayout,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
}: DiagramRendererBaseProps) {
  const measurementKey = JSON.stringify(diagram);

  return (
    <ReactFlowProvider key={measurementKey}>
      <DiagramRendererContent
        ariaLabel={ariaLabel ?? `${diagram.title} diagram`}
        annotations={annotations}
        diagram={diagram}
        onOpenSource={onOpenSource}
        calculateLayout={calculateLayout}
        buildRenderModel={buildRenderModel}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
        onPaneActivate={onPaneActivate}
      />
    </ReactFlowProvider>
  );
}
