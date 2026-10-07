import { MarkerType, Panel } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { attachGuardLabels, collectComponentOrigins } from "@/client/widgets/component-structure-guards";
import {
  componentPathEmphasis,
  type ComponentSelection,
  initialComponentSelection,
  isPolarityPairBranch,
  selectComponentPath,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import {
  describeRouteSelectionChange,
  type RouteConditionChange,
  toDefinitionId,
} from "@/client/widgets/component-structure-route-conditions";
import {
  buildComponentStructureMeasurementNodes,
  buildComponentStructureReactFlowNodes,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { toBezierPath, toPolylinePath, toSplinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";
import type { Artifact } from "@/features/artifact/artifact";
import { isComponentStructureArtifact } from "@/features/artifact/artifact";
import { layoutComponentStructureDiagram } from "@/features/diagram/_layout/component-structure-diagram-layout";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type { DiagramControl } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutEdge, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { type EdgeHoverOrigin, subscribeEdgeHover } from "@/shared/react-flow/edge-hover";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import {
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/shared/react-ui/select";
import { Switch } from "@/shared/react-ui/switch";

function toEdgePath(placement: DiagramLayoutEdge): string {
  if (placement.routing === "spline") return toSplinePath(placement.points);
  if (placement.routing === "bezier") return toBezierPath(placement.points);
  return toPolylinePath(placement.points);
}

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (!isComponentStructureArtifact(diagram)) throw new Error("Expected a component structure diagram layout.");
  // Decision nodes and split segments are display projections, so the
  // layout always places the projected graph.
  return layoutComponentStructureDiagram(projectDecisionNodes(diagram.graph), nodeSizes, diagram.layout.options);
}

// The hover preview for one route: what would have to change to run the
// route's rule, stated as before → after per control and grouped under the
// component that owns each control. An empty list means the route already
// holds.
function RouteChangesPreview({ changes }: Readonly<{ changes: readonly RouteConditionChange[] }>) {
  const groups = new Map<string, RouteConditionChange[]>();
  for (const change of changes) {
    const known = groups.get(change.ownerLabel);
    if (known) known.push(change);
    else groups.set(change.ownerLabel, [change]);
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="font-semibold text-muted-foreground">To run this route</p>
      {changes.length === 0 ? (
        <p className="text-muted-foreground">This route already holds.</p>
      ) : (
        [...groups].map(([ownerLabel, owned]) => (
          <section key={ownerLabel}>
            <h4 className="font-medium text-muted-foreground">{ownerLabel}</h4>
            <ul className="flex flex-col gap-1">
              {owned.map((change) => (
                <li className="flex items-baseline justify-between gap-2" key={change.controlId}>
                  <span className="truncate">{change.label}</span>
                  <span className="shrink-0 font-mono">
                    {change.before} <span aria-hidden="true">→</span> {change.after}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ComponentStructureContent(props: DiagramRendererProps) {
  const { diagram } = props;
  // The projection owns everything display-only: decision nodes, split
  // segments, guards, and non-component nodes.
  const projected = useMemo(
    () => (isComponentStructureArtifact(diagram) ? projectDecisionNodes(diagram.graph) : null),
    [diagram],
  );
  const controls = useMemo(() => projected?.controls ?? [], [projected]);
  const initialSelection = useMemo(() => (projected ? initialComponentSelection(projected) : {}), [projected]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  // Labels report hover into the shared channel; the changes preview reads the
  // same origin the canvas lights the edge from.
  const [hoverOrigin, setHoverOrigin] = useState<EdgeHoverOrigin | null>(null);
  useEffect(() => subscribeEdgeHover(setHoverOrigin), []);
  const hoveredEdgeId = hoverOrigin?.kind === "label" ? hoverOrigin.edgeId : null;

  // Label clicks drive a route's whole rule; owner fields set one control's
  // value directly. Both land in the same selection state.
  const onSelect = useCallback(
    (edgeId: string, controlId: string, value: string) => {
      if (!projected) return;
      setSelection((current) => selectEdgePath(projected, current, edgeId, controlId, value));
    },
    [projected],
  );
  const onControlSelect = useCallback(
    (controlId: string, value: string) => {
      if (!projected) return;
      setSelection((current) => selectComponentPath(projected, current, controlId, value));
    },
    [projected],
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
      if (!projected) return [...nodes];
      const emphasis = componentPathEmphasis(projected, selected);
      const origins = collectComponentOrigins(projected);
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
        // cases as a single-choice select, conditionals as switches — so
        // owned values live in one place.
        const ownedControls = controlsByOwner.get(toDefinitionId(node.id)) ?? [];
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? "Active path" : "Inactive path",
            className: active ? "border-primary/50 bg-primary/5" : "border-dashed bg-muted/50 opacity-60",
            details: [...(node.data.details ?? []), ...nodeOrigins],
            // Hovering nodes stays quiet: the changes preview belongs to
            // guard edge labels, which name the exact rule they show.
            children:
              ownedControls.length > 0 ? (
                <div
                  className="nodrag nopan mt-3 flex max-w-full flex-col gap-1.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  {ownedControls.map((control) =>
                    control.kind === "branch" && !isPolarityPairBranch(control) ? (
                      <label className="flex items-center justify-between gap-2 text-xs" key={control.id}>
                        <span className="truncate">{control.label}</span>
                        <Select
                          items={Object.fromEntries(
                            control.cases.map((branchCase) => [branchCase.id, branchCase.label]),
                          )}
                          onValueChange={(next) => {
                            if (next != null) onControlSelect(control.id, next);
                          }}
                          value={selected[control.id] ?? null}
                        >
                          <SelectTrigger aria-label={control.label}>
                            <SelectValue />
                            <SelectIcon />
                          </SelectTrigger>
                          <SelectPortal>
                            <SelectPositioner>
                              <SelectPopup>
                                {control.cases.map((branchCase) => (
                                  <SelectItem key={branchCase.id} value={branchCase.id}>
                                    <SelectItemIndicator />
                                    <SelectItemText>{branchCase.label}</SelectItemText>
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </SelectPositioner>
                          </SelectPortal>
                        </Select>
                      </label>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-xs" key={control.id}>
                        <span className="truncate">{control.label}</span>
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
    [controlsByOwner, onControlSelect, projected],
  );
  const buildMeasurementNodes = useCallback(
    (measuredDiagram: Artifact, onOpenSource: (href: string) => void) => {
      if (!isComponentStructureArtifact(measuredDiagram)) throw new Error("Expected a component structure layout.");
      return decorateNodes(
        buildComponentStructureMeasurementNodes(projectDecisionNodes(measuredDiagram.graph), onOpenSource),
        initialSelection,
      );
    },
    [decorateNodes, initialSelection],
  );
  const buildRenderModel = useCallback(
    (
      renderedDiagram: Artifact,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ): DiagramReactFlowRenderModel => {
      if (!projected || !isComponentStructureArtifact(renderedDiagram)) {
        throw new Error("Expected a component structure layout.");
      }
      const emphasis = componentPathEmphasis(projected, selection);
      const model: DiagramReactFlowRenderModel = {
        nodes: buildComponentStructureReactFlowNodes(projected, layout, onOpenSource),
        // Projected edges carry no display fields: their condition rides the
        // guard labels, so the routes themselves stay bare.
        edges: layout.edges.map<DiagramReactFlowEdge>((placement) => {
          const edge = projected.edges.find(({ id }) => id === placement.id);
          if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            focusable: false,
            selectable: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
            style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
            type: "route",
            data: {
              path: toEdgePath(placement),
              labelPosition:
                placement.points.length > 1
                  ? getPolylineEdgeLabelPlacement(placement.points)
                  : (placement.points.at(0) ?? { x: 0, y: 0 }),
            },
          };
        }),
      };
      const dimmed = model.edges.map((edge) => {
        const ariaLabel = `${edge.source} to ${edge.target}: ${emphasis.edges.has(edge.id) ? "Active path" : "Inactive path"}`;
        const style = { ...edge.style, opacity: emphasis.edges.has(edge.id) ? 1 : 0.25 };
        return { ...edge, ariaLabel, style };
      });
      const edges = attachGuardLabels({
        controls,
        edges: dimmed,
        graph: projected,
        layout,
        activeEdges: emphasis.edges,
        onSelect,
      });
      return {
        ...model,
        nodes: decorateNodes(model.nodes, selection),
        edges,
      };
    },
    [controls, decorateNodes, onSelect, projected, selection],
  );

  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildMeasurementNodes={buildMeasurementNodes}
      buildRenderModel={buildRenderModel}
    >
      {hoveredEdgeId != null && projected ? (
        // The hover preview is the standard bottom-right info spot — pinned
        // to the viewport like the links panel, not floating over the canvas.
        <Panel className="nodrag nopan nowheel pointer-events-none mb-8!" position="bottom-right">
          <aside
            aria-label="Route changes"
            className="w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <RouteChangesPreview changes={describeRouteSelectionChange(projected, selection, hoveredEdgeId)} />
          </aside>
        </Panel>
      ) : null}
    </DiagramRendererBase>
  );
}

export function ComponentStructureDiagramRenderer(props: DiagramRendererProps) {
  return <ComponentStructureContent key={JSON.stringify(props.diagram)} {...props} />;
}
