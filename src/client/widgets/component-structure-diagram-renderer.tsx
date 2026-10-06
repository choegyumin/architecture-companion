import { useCallback, useMemo, useState } from "react";

import type { DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import {
  attachGuardLabels,
  collectComponentOrigins,
  toDefinitionId,
} from "@/client/widgets/component-structure-guards";
import {
  componentPathEmphasis,
  type ComponentSelection,
  initialComponentSelection,
  isPolarityPairBranch,
  polarityPairLabel,
  selectComponentPath,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import {
  describeRouteSelectionChange,
  representativeIncomingEdgeId,
} from "@/client/widgets/component-structure-route-conditions";
import { RouteDiffCard } from "@/client/widgets/component-structure-route-diff-card";
import {
  buildDiagramMeasurementNodes,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import type { Artifact } from "@/features/artifact/artifact";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { DiagramControl } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";
import { Switch } from "@/shared/react-ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/shared/react-ui/toggle-group";

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
}

const ROUTE_DIFF_NODE_ID = "__route-diff__";
const ROUTE_CONDITION_ENDPOINT_OFFSET = 64;

function ComponentStructureContent(props: DiagramRendererProps) {
  const { diagram } = props;
  const controls = useMemo(() => diagram.graph.controls ?? [], [diagram]);
  const initialSelection = useMemo(() => initialComponentSelection(diagram.graph), [diagram]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Label clicks drive a route's whole rule; owner fields set one control's
  // value directly. Both land in the same selection state.
  const onSelect = useCallback(
    (edgeId: string, controlId: string, value: string) => {
      setSelection((current) => selectEdgePath(diagram.graph, current, edgeId, controlId, value));
    },
    [diagram],
  );
  const onControlSelect = useCallback(
    (controlId: string, value: string) => {
      setSelection((current) => selectComponentPath(diagram.graph, current, controlId, value));
    },
    [diagram],
  );

  const controlsByOwner = useMemo(() => {
    const byOwner = new Map<string, DiagramControl[]>();
    for (const control of controls) {
      const known = byOwner.get(control.owner);
      if (known) known.push(control);
      else byOwner.set(control.owner, [control]);
    }
    return byOwner;
  }, [controls]);

  const decorateNodes = useCallback(
    (nodes: readonly DiagramReactFlowNode[], selected: ComponentSelection): DiagramReactFlowNode[] => {
      const emphasis = componentPathEmphasis(diagram.graph, selected);
      const origins = collectComponentOrigins(diagram.graph);
      return nodes.map((node) => {
        const active = emphasis.nodes.has(node.id);
        if (node.type === "decision") {
          return {
            ...node,
            data: {
              ...node.data,
              active,
              accessibleDescription: active ? "Active path" : "Inactive path",
            },
          };
        }
        if (node.type !== "card") return node;
        const nodeOrigins = origins.get(node.id) ?? [];
        // Every owned control renders its field on the owning card — branch
        // cases as a single-choice toggle group, conditionals as switches — so
        // owned values live in one place.
        const ownedControls = controlsByOwner.get(toDefinitionId(node.id)) ?? [];
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? "Active path" : "Inactive path",
            className: active ? "border-primary/50 bg-primary/5" : "border-dashed bg-muted/50 opacity-60",
            details: [...(node.data.details ?? []), ...nodeOrigins],
            onHoverChange: (hovered: boolean) => {
              // Hovering a card previews its decisive incoming route.
              setHoveredEdgeId(
                hovered ? (representativeIncomingEdgeId(diagram.graph, emphasis.edges, node.id) ?? null) : null,
              );
            },
            children:
              ownedControls.length > 0 ? (
                <div
                  className="nodrag nopan mt-3 flex max-w-full flex-col gap-1.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  {ownedControls.map((control) =>
                    control.kind === "branch" && !isPolarityPairBranch(control) ? (
                      <div className="flex max-w-full flex-col gap-1" key={control.id}>
                        <span className="truncate text-xs text-muted-foreground">{control.label}</span>
                        <ToggleGroup
                          className="max-w-full"
                          onValueChange={(next) => {
                            const caseId = next.at(0);
                            if (caseId != null) onControlSelect(control.id, caseId);
                          }}
                          value={selected[control.id] != null ? [selected[control.id]] : []}
                        >
                          {control.cases.map((branchCase) => (
                            <ToggleGroupItem key={branchCase.id} size="sm" value={branchCase.id}>
                              {branchCase.label}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-xs" key={control.id}>
                        <span className="truncate">
                          {control.kind === "branch" ? polarityPairLabel(control) : control.label}
                        </span>
                        <Switch
                          checked={
                            control.kind === "branch"
                              ? selected[control.id] === control.cases.at(0)?.id
                              : selected[control.id] === "on"
                          }
                          onCheckedChange={(checked) => {
                            if (control.kind !== "branch") {
                              onControlSelect(control.id, checked ? "on" : "off");
                              return;
                            }
                            const caseId = (checked ? control.cases.at(0) : control.cases.at(1))?.id;
                            if (caseId != null) onControlSelect(control.id, caseId);
                          }}
                        />
                      </label>
                    ),
                  )}
                </div>
              ) : undefined,
          },
        };
      });
    },
    [controlsByOwner, diagram, onControlSelect],
  );
  const buildMeasurementNodes = useCallback(
    (measuredDiagram: Artifact, onOpenSource: (href: string) => void) =>
      decorateNodes(buildDiagramMeasurementNodes(measuredDiagram, onOpenSource), initialSelection),
    [decorateNodes, initialSelection],
  );
  const buildRenderModel = useCallback(
    (
      renderedDiagram: Artifact,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ): DiagramReactFlowRenderModel => {
      const model = buildElkLayeredDiagramReactFlowRenderModel(renderedDiagram, layout, onOpenSource);
      const emphasis = componentPathEmphasis(diagram.graph, selection);
      const dimmed = model.edges.map((edge) => {
        const ariaLabel = `${edge.source} to ${edge.target}: ${emphasis.edges.has(edge.id) ? "Active path" : "Inactive path"}`;
        const style = { ...edge.style, opacity: emphasis.edges.has(edge.id) ? 1 : 0.25 };
        if (edge.type !== "route" || !edge.data) return { ...edge, ariaLabel, style };
        // "from X" labels live in the origin bullets inside cards and slot
        // kinds already show there, so the edges themselves stay bare.
        const { eyebrow, ...data } = edge.data;
        void eyebrow;
        const { label, ...bare } = edge;
        void label;
        return { ...bare, ariaLabel, style, data };
      });
      const edges = attachGuardLabels({
        controls,
        edges: dimmed,
        graph: diagram.graph,
        layout,
        onEdgeHover: setHoveredEdgeId,
        onSelect,
        selection,
      });
      // The hover preview rides a passthrough node next to the hovered
      // route's label anchor, so zoom and pan follow it for free.
      const hoveredPoints = layout.edges.find((edge) => edge.id === hoveredEdgeId)?.points;
      const popoverNode: DiagramReactFlowNode | undefined =
        hoveredEdgeId != null && hoveredPoints != null
          ? {
              id: ROUTE_DIFF_NODE_ID,
              position:
                hoveredPoints.length < 2
                  ? (hoveredPoints.at(0) ?? { x: 0, y: 0 })
                  : pointAlongPolyline(
                      hoveredPoints,
                      Math.min(ROUTE_CONDITION_ENDPOINT_OFFSET, polylineArcLength(hoveredPoints) / 2),
                      "end",
                    ),
              data: {
                accessibleDescription: "Route change preview",
                children: (
                  <RouteDiffCard changes={describeRouteSelectionChange(diagram.graph, selection, hoveredEdgeId)} />
                ),
                className: "w-56 p-3",
                label: "Route changes",
              },
              draggable: false,
              focusable: false,
              selectable: false,
              style: { pointerEvents: "none" },
              type: "card",
            }
          : undefined;
      return {
        ...model,
        nodes: [...decorateNodes(model.nodes, selection), ...(popoverNode ? [popoverNode] : [])],
        edges,
      };
    },
    [controls, decorateNodes, diagram, hoveredEdgeId, onSelect, selection],
  );

  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildMeasurementNodes={buildMeasurementNodes}
      buildRenderModel={buildRenderModel}
    />
  );
}

export function ComponentStructureDiagramRenderer(props: DiagramRendererProps) {
  return <ComponentStructureContent key={JSON.stringify(props.diagram)} {...props} />;
}
