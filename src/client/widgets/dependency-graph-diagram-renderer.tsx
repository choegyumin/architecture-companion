import { useCallback, useState } from "react";

import { buildDependencyGraphDiagramReactFlowRenderModel } from "@/client/widgets/dependency-graph-diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import type { DependencyFocus } from "@/features/diagram/dependency-edge-projection";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function calculateLayout(diagram: Diagram, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "dependency-graph") throw new Error("Expected a dependency graph layout.");
  return layoutDependencyGraph(diagram.graph, nodeSizes);
}

export function DependencyGraphDiagramRenderer(props: DiagramRendererProps) {
  const [focus, setFocus] = useState<DependencyFocus>();
  const canFocus =
    !(props.commentEnabled ?? props.annotations.isCommentMode) &&
    !props.annotations.isManaging &&
    !props.annotations.isPublishing;
  const buildRenderModel = useCallback(
    (diagram: Diagram, layout: DiagramLayout, onOpenSource: (href: string) => void) =>
      buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, onOpenSource, {
        focus,
        ...(canFocus
          ? {
              onAggregateActivate: (edgeIds: readonly string[]) =>
                setFocus({ type: "aggregate", edgeIds: [...edgeIds] }),
              onGroupTitleActivate: (id: string) => setFocus({ type: "group", id }),
            }
          : {}),
      }),
    [focus, canFocus],
  );

  return (
    <DiagramRendererBase
      {...props}
      buildRenderModel={buildRenderModel}
      calculateLayout={calculateLayout}
      onNodeActivate={canFocus ? (id) => setFocus({ type: "node", id }) : undefined}
      onPaneActivate={canFocus ? () => setFocus(undefined) : undefined}
    />
  );
}
