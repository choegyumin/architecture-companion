import { Focus, X } from "lucide-react";
import { useCallback, useState } from "react";

import { buildDependencyGraphDiagramReactFlowRenderModel } from "@/client/widgets/dependency-graph-diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import type { Artifact } from "@/features/artifact/artifact";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import type { DependencyFocus } from "@/features/diagram/dependency-edge-projection";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { Button } from "@/shared/react-ui/button";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/shared/react-ui/item";
import { getOrThrow } from "@/shared/universal/get-or-throw";

function calculateLayout(artifact: Artifact, nodeSizes: DiagramNodeSizes) {
  if (artifact.diagram.layout.id !== "dependency-graph") throw new Error("Expected a dependency graph layout.");
  return layoutDependencyGraph(artifact.diagram.graph, nodeSizes);
}

function describeDependencyFocus(artifact: Artifact, focus: DependencyFocus): string {
  if (focus.type !== "aggregate") {
    const element =
      focus.type === "node"
        ? getOrThrow(
            artifact.diagram.graph.nodes.find((node) => node.id === focus.id),
            `Missing focused diagram node: ${focus.id}`,
          )
        : getOrThrow(
            artifact.diagram.graph.groups.find((group) => group.id === focus.id),
            `Missing focused diagram group: ${focus.id}`,
          );
    return `Focused on ${element.title}`;
  }

  const firstEdgeId = focus.edgeIds.at(0);
  const nodesById = new Map(artifact.diagram.graph.nodes.map((node) => [node.id, node]));
  const edge = getOrThrow(
    artifact.diagram.graph.edges.find((candidate) => candidate.id === firstEdgeId),
    `Missing focused aggregate edge: ${firstEdgeId}`,
  );
  const source = getOrThrow(nodesById.get(edge.source), `Missing edge source: ${edge.source}`);
  const target = getOrThrow(nodesById.get(edge.target), `Missing edge target: ${edge.target}`);
  return `${focus.edgeIds.length} edges: ${source.title} → ${target.title}`;
}

function DependencyGraphFocusIndicator({
  artifact,
  focus,
  onClear,
}: Readonly<{
  artifact: Artifact;
  focus: DependencyFocus;
  onClear: () => void;
}>) {
  return (
    <Item
      aria-live="polite"
      className="absolute top-4 left-1/2 w-fit -translate-x-1/2 rounded-full shadow-md"
      role="status"
      size="sm"
      variant="muted"
    >
      <ItemMedia variant="icon">
        <Focus aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="max-w-md">{describeDependencyFocus(artifact, focus)}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Button aria-label="Clear focus" onClick={onClear} size="icon-sm" variant="ghost" className="-m-1.5 ml-0">
          <X aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );
}

export function DependencyGraphDiagramRenderer(props: DiagramRendererProps) {
  const [focus, setFocus] = useState<DependencyFocus>();
  const canFocus =
    !(props.commentEnabled ?? props.annotations.isCommentMode) &&
    !props.annotations.isManaging &&
    !props.annotations.isPublishing;
  const buildRenderModel = useCallback(
    (artifact: Artifact, layout: DiagramLayout, onOpenSource: (href: string) => void) =>
      buildDependencyGraphDiagramReactFlowRenderModel(artifact, layout, onOpenSource, {
        focus,
        nodesActivatable: canFocus,
        ...(canFocus
          ? {
              onAggregateActivate: (edgeIds: readonly string[]) =>
                setFocus({ type: "aggregate", edgeIds: [...edgeIds] }),
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
      onGroupActivate={canFocus ? (id) => setFocus({ type: "group", id }) : undefined}
      onNodeActivate={canFocus ? (id) => setFocus({ type: "node", id }) : undefined}
      onPaneActivate={canFocus ? () => setFocus(undefined) : undefined}
    >
      {focus ? (
        <DependencyGraphFocusIndicator artifact={props.artifact} focus={focus} onClear={() => setFocus(undefined)} />
      ) : null}
    </DiagramRendererBase>
  );
}
