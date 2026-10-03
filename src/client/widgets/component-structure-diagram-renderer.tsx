import { useCallback, useMemo, useRef, useState } from "react";

import type { DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import {
  buildComponentStructureLayoutGraph,
  componentStructureLabelPositions,
} from "@/client/widgets/component-structure-diagram-layout";
import {
  componentPathEmphasis,
  type ComponentSelection,
  initialComponentSelection,
  selectComponentPath,
} from "@/client/widgets/component-structure-path-selection";
import {
  buildDiagramMeasurementNodes,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { Diagram } from "@/features/diagram/diagram";
import type { ComponentControl } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { BranchEdgeLabel } from "@/shared/react-flow/branch-edge-label";
import { ConditionalEdgeLabel } from "@/shared/react-flow/conditional-edge-label";

function ComponentStructureContent(props: DiagramRendererProps) {
  const { diagram } = props;
  const controls = diagram.graph.componentStructure!.controls;
  const initialSelection = useMemo(() => initialComponentSelection(diagram.graph), [diagram]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  const topology = useMemo(() => buildComponentStructureLayoutGraph(diagram.graph), [diagram]);
  const labelElements = useRef(new Map<string, HTMLDivElement>());
  const onSelect = useCallback(
    (controlId: string, value: string) => {
      setSelection((current) => selectComponentPath(diagram.graph, current, controlId, value));
    },
    [diagram],
  );
  const renderControl = useCallback(
    (control: ComponentControl, selected: ComponentSelection, active: boolean) => {
      const description = active ? "Active path" : "Inactive path; selecting activates ancestors";
      const className = active ? undefined : "text-muted-foreground";
      return control.kind === "conditional" ? (
        <ConditionalEdgeLabel
          label={control.label}
          checked={selected[control.id] === "on"}
          description={description}
          className={className}
          onChange={(checked) => onSelect(control.id, checked ? "on" : "off")}
        />
      ) : (
        <BranchEdgeLabel
          label={control.label}
          alternatives={control.alternatives}
          value={selected[control.id]!}
          description={description}
          className={className}
          onSelect={(value) => onSelect(control.id, value)}
        />
      );
    },
    [onSelect],
  );

  const calculateLayout = useCallback(
    (measuredDiagram: Diagram, nodeSizes: DiagramNodeSizes) => {
      if (measuredDiagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
      const labelSizes = Object.fromEntries(
        controls.map((control) => {
          const element = labelElements.current.get(control.id)!;
          return [topology.junctions.get(control.id)!, { width: element.offsetWidth, height: element.offsetHeight }];
        }),
      );
      // Preserve ELK's measured label clearances instead of moving junctions into neighboring cards afterward.
      const options = controls.length
        ? { ...measuredDiagram.layout.options, nudgeObstacleNodes: false }
        : measuredDiagram.layout.options;
      return layoutElkLayeredDiagram(topology.graph, { ...nodeSizes, ...labelSizes }, options);
    },
    [controls, topology],
  );

  const decorateNodes = useCallback(
    (nodes: readonly DiagramReactFlowNode[], selected: ComponentSelection): DiagramReactFlowNode[] => {
      const emphasis = componentPathEmphasis(diagram.graph, selected);
      return nodes.map((node) => {
        if (node.type !== "card") return node;
        const active = emphasis.nodes.has(node.id);
        const original = diagram.graph.nodes.find((item) => item.id === node.id)!;
        const origins = original.type === "default" ? (original.component?.origins ?? []) : [];
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? "Active path" : "Inactive path",
            className: active ? "border-primary/50 bg-primary/5" : "border-dashed bg-muted/50 opacity-60",
            children: origins.length ? (
              <ul aria-label="Supplied content origins" className="mt-3 space-y-1 text-xs text-muted-foreground">
                {origins.map((origin) => (
                  <li key={`${origin.supplierId}:${origin.prop}`}>
                    {origin.supplierTitle} → {origin.prop}
                  </li>
                ))}
              </ul>
            ) : null,
          },
        };
      });
    },
    [diagram],
  );
  const buildMeasurementNodes = useCallback(
    (measuredDiagram: Diagram, onOpenSource: (href: string) => void) =>
      decorateNodes(buildDiagramMeasurementNodes(measuredDiagram, onOpenSource), initialSelection),
    [decorateNodes, initialSelection],
  );
  const buildRenderModel = useCallback(
    (
      renderedDiagram: Diagram,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ): DiagramReactFlowRenderModel => {
      const positions = componentStructureLabelPositions(layout, topology.junctions);
      const junctionPositions = new Map(
        [...topology.junctions].map(([controlId, id]) => [id, positions.get(controlId)!]),
      );
      const routedLayout: DiagramLayout = {
        ...layout,
        nodes: layout.nodes.filter(({ id }) => !junctionPositions.has(id)),
        edges: layout.edges.map((placement) => {
          const edge = topology.graph.edges.find(({ id }) => id === placement.id)!;
          const start = junctionPositions.get(edge.source);
          const end = junctionPositions.get(edge.target);
          return { ...placement, points: [...(start ? [start] : []), ...placement.points, ...(end ? [end] : [])] };
        }),
      };
      // React Flow edges still reference real cards; their supplied paths use the ELK-only junctions.
      const model = buildElkLayeredDiagramReactFlowRenderModel(
        {
          ...renderedDiagram,
          graph: {
            ...renderedDiagram.graph,
            edges: [...topology.routes.values()].map(({ edge }) =>
              edge.type === "default" && /^(NODE|RENDER|COMPONENT) \(.+\)$/.test(edge.kind ?? "")
                ? { ...edge, kind: undefined, label: undefined }
                : edge,
            ),
          },
        },
        routedLayout,
        onOpenSource,
      );
      const emphasis = componentPathEmphasis(diagram.graph, selection);
      return {
        nodes: decorateNodes(model.nodes, selection),
        edges: model.edges.map((edge) => {
          const route = topology.routes.get(edge.id)!;
          const active =
            emphasis.nodes.has(route.edge.source) &&
            route.paths.some((path) =>
              path.every(({ controlId, value }) => selection[controlId] === value && emphasis.controls.has(controlId)),
            );
          const control = controls.find(({ id }) => id === route.controlId);
          const hasLabel = control && topology.labelRoutes.get(control.id) === edge.id;
          const attributes = {
            ariaLabel: `${control ? `Path to ${control.label}` : `${edge.source} to ${edge.target}`}: ${active ? "Active path" : "Inactive path"}`,
            markerEnd: control ? undefined : edge.markerEnd,
            style: { ...edge.style, opacity: active ? 1 : 0.25 },
          };
          return hasLabel && edge.type === "route"
            ? {
                ...edge,
                ...attributes,
                data: {
                  ...edge.data!,
                  labelControl: renderControl(control, selection, emphasis.controls.has(control.id)),
                  labelControlPosition: positions.get(control.id)!,
                },
              }
            : { ...edge, ...attributes };
        }),
        edgeTargets: new Map(
          [...topology.routes].map(([id, route]) => [
            id,
            route.originalEdgeId
              ? { type: "edge" as const, id: route.originalEdgeId }
              : { type: "node" as const, id: route.edge.source },
          ]),
        ),
      };
    },
    [controls, decorateNodes, diagram, renderControl, selection, topology],
  );

  return (
    <DiagramRendererBase
      {...props}
      calculateLayout={calculateLayout}
      buildMeasurementNodes={buildMeasurementNodes}
      buildRenderModel={buildRenderModel}
    >
      <div aria-hidden="true" className="pointer-events-none absolute top-0 left-[-10000px] w-max" inert>
        {controls.map((control) => (
          <div
            key={control.id}
            className="w-max"
            ref={(element) => {
              if (element) labelElements.current.set(control.id, element);
              else labelElements.current.delete(control.id);
            }}
          >
            {renderControl(control, initialSelection, true)}
          </div>
        ))}
      </div>
    </DiagramRendererBase>
  );
}

export function ComponentStructureDiagramRenderer(props: DiagramRendererProps) {
  return <ComponentStructureContent key={JSON.stringify(props.diagram)} {...props} />;
}
