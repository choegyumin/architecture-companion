import { useCallback, useMemo, useState } from "react";

import type { DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { ComponentStructureControls } from "@/client/widgets/component-structure-controls";
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
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(diagram: Diagram, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
}

function ComponentStructureContent(props: DiagramRendererProps) {
  const { diagram } = props;
  const initialSelection = useMemo(() => initialComponentSelection(diagram.graph), [diagram]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  const onSelect = useCallback(
    (controlId: string, value: string) => {
      setSelection((current) => selectComponentPath(diagram.graph, current, controlId, value));
    },
    [diagram],
  );

  const decorateNodes = useCallback(
    (nodes: readonly DiagramReactFlowNode[], selected: ComponentSelection): DiagramReactFlowNode[] => {
      const emphasis = componentPathEmphasis(diagram.graph, selected);
      return nodes.map((node) => {
        if (node.type !== "card") return node;
        const controls = diagram.graph.componentStructure!.controls.filter((control) => control.source === node.id);
        const active = emphasis.nodes.has(node.id);
        const original = diagram.graph.nodes.find((item) => item.id === node.id)!;
        const origins = original.type === "default" ? (original.component?.origins ?? []) : [];
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? "Active path" : "Inactive path",
            className: active ? "border-primary/50 bg-primary/5" : "border-dashed bg-muted/50 opacity-60",
            children: (
              <>
                {origins.length ? (
                  <ul aria-label="Supplied content origins" className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {origins.map((origin) => (
                      <li key={`${origin.supplierId}:${origin.prop}`}>
                        {origin.supplierTitle} → {origin.prop}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {controls.length ? (
                  <ComponentStructureControls
                    controls={controls}
                    activeControls={emphasis.controls}
                    selection={selected}
                    onSelect={onSelect}
                  />
                ) : null}
              </>
            ),
          },
        };
      });
    },
    [diagram, onSelect],
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
      const model = buildElkLayeredDiagramReactFlowRenderModel(renderedDiagram, layout, onOpenSource);
      const emphasis = componentPathEmphasis(diagram.graph, selection);
      return {
        ...model,
        nodes: decorateNodes(model.nodes, selection),
        edges: model.edges.map((edge) => ({
          ...edge,
          ariaLabel: `${edge.source} to ${edge.target}: ${emphasis.edges.has(edge.id) ? "Active path" : "Inactive path"}`,
          style: { ...edge.style, opacity: emphasis.edges.has(edge.id) ? 1 : 0.25 },
        })),
      };
    },
    [decorateNodes, diagram, selection],
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
