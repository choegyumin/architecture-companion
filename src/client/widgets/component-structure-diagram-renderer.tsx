import { useCallback, useMemo, useState } from "react";

import type { DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import { attachGuardLabels, collectComponentOrigins } from "@/client/widgets/component-structure-guards";
import {
  componentPathEmphasis,
  type ComponentSelection,
  initialComponentSelection,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import {
  buildDiagramMeasurementNodes,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import type { Artifact } from "@/features/artifact/artifact";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(diagram: Artifact, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
}

function ComponentStructureContent(props: DiagramRendererProps) {
  const { diagram } = props;
  const initialSelection = useMemo(() => initialComponentSelection(diagram.graph), [diagram]);
  const [selection, setSelection] = useState<ComponentSelection>(initialSelection);
  const onSelect = useCallback(
    (edgeId: string, controlId: string, value: string) => {
      setSelection((current) => selectEdgePath(diagram.graph, current, edgeId, controlId, value));
    },
    [diagram],
  );

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
        return {
          ...node,
          data: {
            ...node.data,
            accessibleDescription: active ? "Active path" : "Inactive path",
            className: active ? "border-primary/50 bg-primary/5" : "border-dashed bg-muted/50 opacity-60",
            details: [...(node.data.details ?? []), ...nodeOrigins],
          },
        };
      });
    },
    [diagram],
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
      return {
        ...model,
        nodes: decorateNodes(model.nodes, selection),
        edges: attachGuardLabels({
          graph: diagram.graph,
          controls: diagram.graph.controls!,
          layout,
          edges: dimmed,
          selection,
          onSelect,
        }),
      };
    },
    [decorateNodes, diagram, onSelect, selection],
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
