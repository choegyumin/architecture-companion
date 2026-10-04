import { ReactFlowProvider, useNodesState, useReactFlow } from "@xyflow/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import type { Artifact } from "@/features/artifact/artifact";
import { diagramEdgeDisplay } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";
import { cn } from "@/shared/react/class-name";
import { BaseOverlayPanel } from "@/shared/react-flow/base-overlay-panel";
import { applySpotlight } from "@/client/widgets/diagram-spotlight";

export type DiagramRendererProps = Readonly<{
  annotations: AnnotationCanvasController;
  artifact: Artifact;
  ariaLabel?: string;
  commentEnabled?: boolean;
  onOpenSource: (href: string) => void;
  spotlight?: ArtifactSpotlight;
}>;

type DiagramRendererBaseProps = DiagramRendererProps &
  Readonly<{
    calculateLayout: (artifact: Artifact, nodeSizes: DiagramNodeSizes) => Promise<DiagramLayout>;
    children?: ReactNode;
    /** Renderers whose measured nodes differ from the stored graph (projections) supply their own. */
    buildMeasurementNodes?: (artifact: Artifact, onOpenSource: (href: string) => void) => DiagramReactFlowNode[];
    buildRenderModel: (
      artifact: Artifact,
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
  children,
  artifact,
  onOpenSource,
  spotlight,
  calculateLayout,
  buildMeasurementNodes = buildDiagramMeasurementNodes,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
}: DiagramContentProps) {
  const measurementNodes = useMemo(
    () => buildMeasurementNodes(artifact, onOpenSource),
    [artifact, onOpenSource, buildMeasurementNodes],
  );
  const searchLabels = useMemo(
    () =>
      new Map([...artifact.diagram.graph.nodes, ...artifact.diagram.graph.groups].map(({ id, title }) => [id, title])),
    [artifact],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramReactFlowNode>(measurementNodes);
  const [state, setState] = useState<DiagramLayoutState>({ status: "measuring" });
  const hasStartedLayout = useRef(false);
  const { getNodes } = useReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>();
  const latestLayoutInputs = useRef({ artifact, getNodes, calculateLayout });

  useEffect(() => {
    latestLayoutInputs.current = { artifact, getNodes, calculateLayout };
  }, [artifact, getNodes, calculateLayout]);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const runLayout = () => {
      if (cancelled || hasStartedLayout.current) return;
      hasStartedLayout.current = true;
      const { artifact, getNodes, calculateLayout } = latestLayoutInputs.current;
      let measuredNodeSizes: ReturnType<typeof resolveDiagramNodeSizes>;
      try {
        measuredNodeSizes = resolveDiagramNodeSizes(artifact.diagram, getNodes());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Diagram measurement failed.";
        setState({ status: "error", message });
        return;
      }

      setState({ status: "layouting" });
      void calculateLayout(artifact, measuredNodeSizes)
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
      return { status: "ready", model: buildRenderModel(artifact, state.layout, onOpenSource) } as const;
    } catch (error: unknown) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Diagram rendering failed.",
      } as const;
    }
  }, [state, artifact, onOpenSource, buildRenderModel]);

  const spotlit = useMemo(
    () => (rendered?.status === "ready" && spotlight ? applySpotlight(rendered.model, spotlight) : undefined),
    [rendered, spotlight],
  );
  const displayModel = spotlit?.model ?? (rendered?.status === "ready" ? rendered.model : undefined);

  useLayoutEffect(() => {
    if (displayModel) setNodes([...displayModel.nodes]);
  }, [displayModel, setNodes]);

  return (
    <div aria-label={ariaLabel} className="relative h-full min-h-0 overflow-hidden bg-background" role="region">
      <ul aria-label="Diagram elements and connections" className="sr-only">
        {artifact.diagram.graph.nodes.map((node) => (
          <li key={node.id}>
            {node.kind}: {node.title}
          </li>
        ))}
        {artifact.diagram.graph.edges.map((edge) => (
          <li key={edge.id}>
            {edge.source} to {edge.target}
            {diagramEdgeDisplay(edge).label ? (
              <>
                {": "}
                <span>{diagramEdgeDisplay(edge).label}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <DiagramCanvas
        className={cn(annotations.isCommentMode && "[&_.react-flow__pane]:cursor-crosshair")}
        edges={displayModel ? [...displayModel.edges] : []}
        focusView={
          spotlit && spotlight ? { key: JSON.stringify(spotlight), nodeIds: spotlit.framedNodeIds } : undefined
        }
        getNodeLabel={displayModel ? (node) => searchLabels.get(node.id) ?? "" : undefined}
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
        <DiagramLinksPanel links={artifact.links ?? []} onOpenSource={onOpenSource} />
      </DiagramCanvas>
      {children}
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
  children,
  artifact,
  onOpenSource,
  spotlight,
  calculateLayout,
  buildMeasurementNodes,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
}: DiagramRendererBaseProps) {
  const measurementKey = JSON.stringify(artifact);

  return (
    <ReactFlowProvider key={measurementKey}>
      <DiagramRendererContent
        ariaLabel={ariaLabel ?? `${artifact.title} diagram`}
        annotations={annotations}
        artifact={artifact}
        onOpenSource={onOpenSource}
        spotlight={spotlight}
        calculateLayout={calculateLayout}
        buildMeasurementNodes={buildMeasurementNodes}
        buildRenderModel={buildRenderModel}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
        onPaneActivate={onPaneActivate}
      >
        {children}
      </DiagramRendererContent>
    </ReactFlowProvider>
  );
}
