import { Panel } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import type { DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { attachGuardLabels, collectComponentOrigins } from "@/client/widgets/component-structure-guards";
import {
  componentPathEmphasis,
  type ComponentSelection,
  initialComponentSelection,
  isPolarityPairBranch,
  selectComponentPath,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import { describeRouteSelectionChange, toDefinitionId } from "@/client/widgets/component-structure-route-conditions";
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

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
}

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
            // route condition labels, which name the exact rule they show.
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
        activeEdges: emphasis.edges,
        onEdgeHover: setHoveredEdgeId,
        onSelect,
      });
      return {
        ...model,
        nodes: decorateNodes(model.nodes, selection),
        edges,
      };
    },
    [controls, decorateNodes, diagram, onSelect, selection],
  );

  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildMeasurementNodes={buildMeasurementNodes}
      buildRenderModel={buildRenderModel}
    >
      {hoveredEdgeId != null ? (
        // The hover preview is the standard bottom-right info spot — pinned
        // to the viewport like the links panel, not floating over the canvas.
        <Panel className="nodrag nopan nowheel pointer-events-none mb-8!" position="bottom-right">
          <aside
            aria-label="Route changes"
            className="w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <RouteDiffCard changes={describeRouteSelectionChange(diagram.graph, selection, hoveredEdgeId)} />
          </aside>
        </Panel>
      ) : null}
    </DiagramRendererBase>
  );
}

export function ComponentStructureDiagramRenderer(props: DiagramRendererProps) {
  return <ComponentStructureContent key={JSON.stringify(props.diagram)} {...props} />;
}
