import { ReactFlowProvider, useNodesState, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { AnnotationLayer } from "@/client/parts/annotation-layer";
import { DiagramCanvas, type DiagramReactFlowEdge, type DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { DiagramLinksPanel } from "@/client/widgets/diagram-links-panel";
import {
  buildDiagramMeasurementNodes,
  buildDiagramReactFlowEdges,
  buildDiagramReactFlowRenderModel,
  type DiagramReactFlowRenderModel,
  resolveDiagramNodeSizes,
} from "@/client/widgets/diagram-renderer.react-flow";
import type { DiagramDependencyFocus } from "@/features/diagram/dependency-edge-projection";
import type { Diagram } from "@/features/diagram/diagram";
import { layoutDiagram } from "@/features/diagram/diagram-layout";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { cn } from "@/shared/react/class-name";
import { BaseOverlayPanel } from "@/shared/react-flow/base-overlay-panel";

type DiagramRendererProps = Readonly<{
  ariaLabel?: string;
  annotations: AnnotationCanvasController;
  diagram: Diagram;
  onOpenSource: (href: string) => void;
}>;

type DiagramLayoutState =
  | Readonly<{ status: "measuring" | "layouting" }>
  | Readonly<{
      status: "ready";
      layout: DiagramLayout;
    }>
  | Readonly<{ status: "error"; message: string }>;

type DiagramContentProps = Readonly<{
  ariaLabel: string;
  annotations: AnnotationCanvasController;
  diagram: Diagram;
  onOpenSource: (href: string) => void;
}>;

function DiagramRendererContent({ ariaLabel, annotations, diagram, onOpenSource }: DiagramContentProps) {
  const measurementNodes = useMemo(() => buildDiagramMeasurementNodes(diagram, onOpenSource), [diagram, onOpenSource]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramReactFlowNode>(measurementNodes);
  const [state, setState] = useState<DiagramLayoutState>({ status: "measuring" });
  const [dependencyFocus, setDependencyFocus] = useState<DiagramDependencyFocus>();
  const hasStartedLayout = useRef(false);
  const { getNodes } = useReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>();
  const latestLayoutInputs = useRef({ diagram, getNodes, onOpenSource, setNodes });
  const supportsDependencyFocus = diagram.layout.id === "prototype-group-rows";
  const focusDependencyBundle = useCallback((edgeIds: readonly string[]) => {
    setDependencyFocus({ type: "aggregate", edgeIds });
  }, []);
  const onDependencyBundleFocus =
    !annotations.isCommentMode && supportsDependencyFocus ? focusDependencyBundle : undefined;
  const edges = useMemo(
    () =>
      state.status === "ready"
        ? [...buildDiagramReactFlowEdges(diagram, state.layout, onOpenSource, dependencyFocus, onDependencyBundleFocus)]
        : [],
    [dependencyFocus, diagram, onDependencyBundleFocus, onOpenSource, state],
  );

  useEffect(() => {
    latestLayoutInputs.current = { diagram, getNodes, onOpenSource, setNodes };
  }, [diagram, getNodes, onOpenSource, setNodes]);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const runLayout = () => {
      if (cancelled || hasStartedLayout.current) return;
      hasStartedLayout.current = true;
      const { diagram, getNodes, onOpenSource, setNodes } = latestLayoutInputs.current;
      let measuredNodeSizes: ReturnType<typeof resolveDiagramNodeSizes>;
      try {
        measuredNodeSizes = resolveDiagramNodeSizes(diagram, getNodes());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Diagram measurement failed.";
        setState({ status: "error", message });
        return;
      }

      setState({ status: "layouting" });
      void layoutDiagram(diagram, measuredNodeSizes)
        .then((layout) => {
          if (cancelled) return;
          const flow: DiagramReactFlowRenderModel = buildDiagramReactFlowRenderModel(diagram, layout, onOpenSource);
          setNodes([...flow.nodes]);
          setState({ status: "ready", layout });
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
        edges={edges}
        nodes={nodes}
        onCanvasClick={
          annotations.isCommentMode
            ? (point, target) => {
                annotations.begin({
                  ...annotations.surface,
                  ...(target ? { target } : {}),
                  point,
                });
              }
            : undefined
        }
        onModuleClick={!annotations.isCommentMode && supportsDependencyFocus ? setDependencyFocus : undefined}
        onNodesChange={onNodesChange}
        onPaneClick={
          !annotations.isCommentMode && supportsDependencyFocus ? () => setDependencyFocus(undefined) : undefined
        }
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
      {state.status === "error" ? (
        <p
          className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function DiagramRenderer({ ariaLabel, annotations, diagram, onOpenSource }: DiagramRendererProps) {
  const measurementKey = JSON.stringify(diagram);

  return (
    <ReactFlowProvider key={measurementKey}>
      <DiagramRendererContent
        ariaLabel={ariaLabel ?? `${diagram.title} diagram`}
        annotations={annotations}
        diagram={diagram}
        onOpenSource={onOpenSource}
      />
    </ReactFlowProvider>
  );
}
