import { addEventListener } from "@base-ui/utils/addEventListener";
import { platform } from "@base-ui/utils/platform";
import { ControlButton, Controls, Panel, ReactFlowProvider, useNodesState, useReactFlow } from "@xyflow/react";
import { ExternalLink, FileCode2, Maximize } from "lucide-react";
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
import {
  type DiagramCameraControls,
  DiagramCanvas,
  type DiagramReactFlowEdge,
  type DiagramReactFlowNode,
} from "@/client/parts/diagram-canvas";
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
import { ElementSearch } from "@/shared/react-flow/element-search";
import { Button } from "@/shared/react-ui/button";
import { Kbd } from "@/shared/react-ui/kbd";

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
    /** An ActiveIndicator describing the caller's currently active state. */
    activeIndicator?: ReactNode;
    /** An ExplanationPanel containing the caller's explanation. */
    explanationPanel?: ReactNode;
    /** A ReferencePanel containing the caller's supporting information. */
    referencePanel?: ReactNode;
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
  );
}

function DiagramViewContent({
  ariaLabel,
  annotations,
  activeIndicator,
  explanationPanel,
  referencePanel,
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
  const [searchMatches, setSearchMatches] = useState<{ ids: ReadonlySet<string>; currentId: string | null }>({
    ids: new Set(),
    currentId: null,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMacOS = platform.os.mac;
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

  const searchEnabled = rendered?.status === "ready";
  const handleSearchMatchesChange = useCallback(
    (matches: readonly DiagramReactFlowNode[], currentNode: DiagramReactFlowNode | null) => {
      const ids = new Set(matches.map((node) => node.id));
      const currentId = currentNode?.id ?? null;
      setSearchMatches((previous) =>
        previous.currentId === currentId &&
        previous.ids.size === ids.size &&
        [...ids].every((id) => previous.ids.has(id))
          ? previous
          : { ids, currentId },
      );
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

  useEffect(() => {
    if (!searchEnabled) return;
    return addEventListener(document, "keydown", (event) => {
      const modifierPressed = isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (
        !searchInputRef.current ||
        !modifierPressed ||
        event.key.toLowerCase() !== "k" ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      searchInputRef.current.focus();
    });
  }, [isMacOS, searchEnabled]);

  function handleSearchSelect(node: DiagramReactFlowNode, camera: DiagramCameraControls): void {
    if (node.type === "rectangle" || node.type === "diamond") onNodeActivate?.(node.id);
    if (node.type === "labeled-group" || (node.type === "bounding-group" && node.data.label != null))
      onGroupActivate?.(node.id);
    void camera.focusNodes([node.id]);
  }

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
        nodes={searchStampedNodes}
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
        renderOverlays={(camera) => {
          // Declare fixed overlays in screen order: top to bottom, left to right.
          const searchOverlay =
            searchEnabled && camera.cameraReady ? (
              <Panel className="nodrag nopan nowheel" position="top-left">
                <ElementSearch<DiagramReactFlowNode>
                  getNodeLabel={getNodeLabel}
                  searchQuery={searchQuery}
                  onSearchQueryChange={onSearchQueryChange}
                  inputRef={searchInputRef}
                  onMatchesChange={handleSearchMatchesChange}
                  onSelectNode={(node) => handleSearchSelect(node, camera)}
                  endInputAddon={<Kbd>{isMacOS ? "⌘K" : "Ctrl+K"}</Kbd>}
                />
              </Panel>
            ) : null;
          const activeOverlay =
            activeIndicator != null ? (
              <Panel className="m-4!" position="top-center">
                {activeIndicator}
              </Panel>
            ) : null;
          const explanationOverlay =
            explanationPanel != null ? (
              <Panel className="flex max-h-[50%] min-h-0" position="top-right">
                {explanationPanel}
              </Panel>
            ) : null;

          const layoutOverlay =
            state.status === "measuring" || state.status === "layouting" ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                Laying out…
              </div>
            ) : null;
          const errorOverlay =
            state.status === "error" || rendered?.status === "error" ? (
              <p
                className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-destructive"
                role="alert"
              >
                {state.status === "error" ? state.message : rendered?.status === "error" ? rendered.message : null}
              </p>
            ) : null;
          const annotationsOverlay = (
            <BaseOverlayPanel>
              {(overlay) => <AnnotationLayer {...overlay} controller={annotations} />}
            </BaseOverlayPanel>
          );

          const controlsOverlay = (
            <Controls position="bottom-left" showFitView={false} showInteractive={false}>
              <ControlButton aria-label="Fit View" onClick={() => void camera.fitView()} title="Fit View">
                <Maximize aria-hidden="true" />
              </ControlButton>
            </Controls>
          );
          const linksOverlay =
            (artifact.links?.length ?? 0) > 0 ? (
              <Panel className="mb-8!" position="bottom-right">
                <DiagramLinksPanel links={artifact.links ?? []} onOpenSource={onOpenSource} />
              </Panel>
            ) : null;
          const referenceOverlay =
            referencePanel != null ? (
              <Panel className="nodrag nopan nowheel pointer-events-none mb-8!" position="bottom-right">
                {referencePanel}
              </Panel>
            ) : null;

          // Keep the existing control-first keyboard traversal and status-overlay stacking.
          return (
            <>
              {controlsOverlay}
              {searchOverlay}
              {annotationsOverlay}
              {linksOverlay}
              {activeOverlay}
              {explanationOverlay}
              {referenceOverlay}
              {layoutOverlay}
              {errorOverlay}
            </>
          );
        }}
      />
    </div>
  );
}

export function DiagramView({
  ariaLabel,
  annotations,
  activeIndicator,
  explanationPanel,
  referencePanel,
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
        activeIndicator={activeIndicator}
        explanationPanel={explanationPanel}
        referencePanel={referencePanel}
      />
    </ReactFlowProvider>
  );
}
