import { Panel, ReactFlowProvider, useNodesState, useReactFlow } from "@xyflow/react";
import { ExternalLink, FileCode2 } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { AnnotationLayer } from "@/client/parts/annotation-layer";
import { DiagramCanvas, type DiagramReactFlowEdge, type DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import {
  buildDiagramMeasurementNodes,
  type DiagramReactFlowRenderModel,
  resolveDiagramNodeSizes,
} from "@/client/parts/diagram-view.react-flow";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { diagramEdgeDisplay, type DiagramLink } from "@/features/diagram/diagram-graph";
import { getDiagramLinkLabel, isSourceLinkHref } from "@/features/diagram/diagram-link";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { cn } from "@/shared/react/class-name";
import { BaseOverlayPanel } from "@/shared/react-flow/base-overlay-panel";
import { Button } from "@/shared/react-ui/button";

export type DiagramRendererProps = Readonly<{
  annotations: AnnotationCanvasController;
  artifact: Artifact;
  ariaLabel?: string;
  commentEnabled?: boolean;
  onOpenSource: (href: string) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}>;

type DiagramViewProps = DiagramRendererProps &
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

type DiagramContentProps = DiagramViewProps & Readonly<{ ariaLabel: string }>;

type DiagramLinksPanelProps = Readonly<{
  links: readonly DiagramLink[];
  onOpenSource: (href: string) => void;
}>;

function DiagramLinksPanel({ links, onOpenSource }: DiagramLinksPanelProps) {
  if (links.length === 0) return null;

  const onLinkActivate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!isSourceLinkHref(href)) return;
    event.preventDefault();
    onOpenSource(href);
  };

  return (
    <Panel className="mb-8!" position="bottom-right">
      <nav aria-label="Artifact links" className="flex max-w-xs flex-col gap-1.5">
        {links.map((link, index) => {
          const Icon = isSourceLinkHref(link.href) ? FileCode2 : ExternalLink;
          const label = getDiagramLinkLabel(link);

          return (
            <Button
              className="nodrag nopan justify-start"
              key={`${link.href}:${index}`}
              nativeButton={false}
              render={
                <a
                  href={link.href}
                  onClick={(event) => onLinkActivate(event, link.href)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="xs"
              title={label}
              variant="outline"
            >
              <Icon aria-hidden="true" data-icon="inline-start" />
              <span className="min-w-0 truncate">Open {label}</span>
            </Button>
          );
        })}
      </nav>
    </Panel>
  );
}

function DiagramViewContent({
  ariaLabel,
  annotations,
  children,
  artifact,
  onOpenSource,
  calculateLayout,
  buildMeasurementNodes = buildDiagramMeasurementNodes,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
  searchQuery,
  onSearchQueryChange,
}: DiagramContentProps) {
  const measurementNodes = useMemo(
    () => buildMeasurementNodes(artifact, onOpenSource),
    [artifact, onOpenSource, buildMeasurementNodes],
  );
  const searchLabels = useMemo(
    () =>
      new Map([
        ...artifact.diagram.graph.nodes.map((node) => [node.nodeId, node.title] as const),
        ...artifact.diagram.graph.groups.map((group) => [group.groupId, group.title] as const),
      ]),
    [artifact],
  );
  const getNodeLabel = useCallback((node: DiagramReactFlowNode) => searchLabels.get(node.id) ?? "", [searchLabels]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramReactFlowNode>(measurementNodes);
  const [state, setState] = useState<DiagramLayoutState>({ status: "measuring" });
  const hasStartedLayout = useRef(false);
  const { getNodes } = useReactFlow<DiagramReactFlowNode, DiagramReactFlowEdge>();
  const latestLayoutInputs = useRef({ artifact, getNodes, calculateLayout, measurementNodes });

  useEffect(() => {
    latestLayoutInputs.current = { artifact, getNodes, calculateLayout, measurementNodes };
  }, [artifact, getNodes, calculateLayout, measurementNodes]);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const runLayout = () => {
      if (cancelled || hasStartedLayout.current) return;
      hasStartedLayout.current = true;
      const { artifact, getNodes, calculateLayout, measurementNodes } = latestLayoutInputs.current;
      let measuredNodeSizes: ReturnType<typeof resolveDiagramNodeSizes>;
      try {
        measuredNodeSizes = resolveDiagramNodeSizes(
          measurementNodes.map(({ id }) => id),
          getNodes(),
        );
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

  useLayoutEffect(() => {
    if (rendered?.status === "ready") setNodes([...rendered.model.nodes]);
  }, [rendered, setNodes]);

  return (
    <div aria-label={ariaLabel} className="relative h-full min-h-0 overflow-hidden bg-background" role="region">
      <ul aria-label="Diagram elements and connections" className="sr-only">
        {artifact.diagram.graph.nodes.map((node) => (
          <li key={node.nodeId}>
            {"kind" in node && node.kind ? `${node.kind}: ` : ""}
            {node.title}
          </li>
        ))}
        {artifact.diagram.graph.edges.map((edge) => (
          <li key={edge.edgeId}>
            {edge.sourceNodeId} to {edge.targetNodeId}
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
        edges={rendered?.status === "ready" ? [...rendered.model.edges] : []}
        getNodeLabel={rendered?.status === "ready" ? getNodeLabel : undefined}
        searchQuery={searchQuery}
        onSearchQueryChange={onSearchQueryChange}
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

export function DiagramView({
  ariaLabel,
  annotations,
  children,
  artifact,
  onOpenSource,
  calculateLayout,
  buildMeasurementNodes,
  buildRenderModel,
  onGroupActivate,
  onNodeActivate,
  onPaneActivate,
  searchQuery,
  onSearchQueryChange,
}: DiagramViewProps) {
  const measurementKey = JSON.stringify(artifact);

  return (
    <ReactFlowProvider key={measurementKey}>
      <DiagramViewContent
        ariaLabel={ariaLabel ?? `${artifact.title} diagram`}
        annotations={annotations}
        artifact={artifact}
        onOpenSource={onOpenSource}
        calculateLayout={calculateLayout}
        buildMeasurementNodes={buildMeasurementNodes}
        buildRenderModel={buildRenderModel}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
        onPaneActivate={onPaneActivate}
        searchQuery={searchQuery}
        onSearchQueryChange={onSearchQueryChange}
      >
        {children}
      </DiagramViewContent>
    </ReactFlowProvider>
  );
}
