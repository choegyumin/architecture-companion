// PROTOTYPE — throwaway exploration, do not extend.
//
// Questions this prototype answers:
// 1. Do node-born slot origins ("from X (children node)") stay readable when
//    merged nodes carry several origins?
// 2. Can render-path branches be selected at a single fork edge label (segment
//    control) so the whole diagram stays visible while sibling paths dim?
//
// Dev-only wiring: DiagramRenderer routes the component-structure diagram here
// when the URL carries ?variant=component-composition.

import { MarkerType } from "@xyflow/react";
import { useCallback, useState } from "react";

import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  DIAGRAM_EDGE_COLOR,
  type DiagramReactFlowRenderModel,
} from "@/client/widgets/diagram-renderer.react-flow";
import { DiagramRendererBase, type DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import { toBezierPath, toPolylinePath, toSplinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";
import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { Diagram } from "@/features/diagram/diagram";
import type { DefaultDiagramEdge, DiagramEdge } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutEdge, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import type { RouteReactFlowEdge } from "@/shared/react-flow/route-edge";
import { ToggleGroup, ToggleGroupItem } from "@/shared/react-ui/toggle-group";

type CompositionSelection = Readonly<Record<string, string>>;

const INSTANCE_ID_SUFFIX = /@[0-9a-f]{16}$/;
const PROP_KIND_PATTERN = /^(\S+)\s+\((.+)\)$/;

function toDefinitionId(nodeId: string): string {
  return nodeId.replace(INSTANCE_ID_SUFFIX, "");
}

function toForkId(edge: DiagramEdge): string {
  return `${edge.source}\0${toDefinitionId(edge.target)}`;
}

function collectForkGroups(edges: readonly DiagramEdge[]): Map<string, DefaultDiagramEdge[]> {
  const groups = new Map<string, DefaultDiagramEdge[]>();
  for (const edge of edges) {
    if (edge.type !== "default") continue;
    const forkId = toForkId(edge);
    const group = groups.get(forkId);
    if (group) group.push(edge);
    else groups.set(forkId, [edge]);
  }
  return new Map([...groups].filter(([, group]) => group.length > 1));
}

function toOriginEntries(edge: DefaultDiagramEdge): readonly string[] {
  if (!edge.label) return [];
  const match = edge.kind ? PROP_KIND_PATTERN.exec(edge.kind) : null;
  const propType = match?.at(1);
  const slotName = match?.at(2);
  return propType != null && slotName != null
    ? [`${edge.label} (${slotName} ${propType.toLowerCase()})`]
    : [edge.label];
}

function collectOrigins(edges: readonly DiagramEdge[]): Map<string, string[]> {
  const origins = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type !== "default") continue;
    for (const entry of toOriginEntries(edge)) {
      const nodeOrigins = origins.get(edge.target);
      if (nodeOrigins) nodeOrigins.add(entry);
      else origins.set(edge.target, new Set([entry]));
    }
  }
  return new Map([...origins].map(([target, entries]) => [target, [...entries].toSorted()]));
}

function collectOutgoing(edges: readonly DiagramEdge[]): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  return outgoing;
}

function collectReachableWithDepth(
  edges: readonly DiagramEdge[],
  startNodeId: string,
): Readonly<{ nodeIds: Set<string>; maxDepth: number }> {
  const outgoing = collectOutgoing(edges);
  const nodeIds = new Set<string>([startNodeId]);
  let frontier = [startNodeId];
  let maxDepth = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const target of outgoing.get(nodeId) ?? []) {
        if (!nodeIds.has(target)) {
          nodeIds.add(target);
          next.push(target);
        }
      }
    }
    if (next.length > 0) maxDepth += 1;
    frontier = next;
  }
  return { nodeIds, maxDepth };
}

function collectDescendantTitleSet(diagram: Diagram, startNodeId: string, maxDepth: number): Set<string> {
  const titleByDefinition = new Map(diagram.graph.nodes.map(({ id, title }) => [toDefinitionId(id), title]));
  const outgoing = collectOutgoing(diagram.graph.edges);
  const titles = new Set<string>();
  let frontier = [startNodeId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    frontier = frontier.flatMap((nodeId) => outgoing.get(nodeId) ?? []);
    for (const nodeId of frontier) {
      const title = titleByDefinition.get(toDefinitionId(nodeId));
      if (title) titles.add(title);
    }
  }
  return titles;
}

function toTruncatedLabel(titles: readonly string[]): string {
  const label = titles.join(", ");
  return label.length > 48 ? `${label.slice(0, 45)}…` : label;
}

function toForkOptionLabels(diagram: Diagram, forkEdges: readonly DefaultDiagramEdge[]): string[] {
  for (let depth = 1; depth <= 4; depth += 1) {
    const titleSets = forkEdges.map((edge) => collectDescendantTitleSet(diagram, edge.target, depth));
    const signatures = titleSets.map((titles) => [...titles].toSorted().join("\0"));
    if (new Set(signatures).size !== forkEdges.length) continue;
    return titleSets.map((titles, index) => {
      const sharedTitles = new Set(titleSets.flatMap((set, setIndex) => (setIndex === index ? [] : [...set])));
      const distinguishing = [...titles].filter((title) => !sharedTitles.has(title)).toSorted();
      return toTruncatedLabel(distinguishing.length > 0 ? distinguishing : [...titles].toSorted());
    });
  }
  return forkEdges.map((_, index) => `path ${index + 1}`);
}

// Default activation: busiest path first (happy path heuristic), then deepest,
// then a determinism-only fallback (edge id, reverse lexicographic).
function toDefaultSelection(diagram: Diagram): CompositionSelection {
  const selection: Record<string, string> = {};
  for (const [forkId, forkEdges] of collectForkGroups(diagram.graph.edges)) {
    selection[forkId] = forkEdges
      .map((edge) => {
        const { nodeIds, maxDepth } = collectReachableWithDepth(diagram.graph.edges, edge.target);
        return { edge, descendantCount: nodeIds.size, maxDepth };
      })
      .toSorted(
        (a, b) =>
          b.descendantCount - a.descendantCount || b.maxDepth - a.maxDepth || b.edge.id.localeCompare(a.edge.id),
      )
      .at(0)!.edge.id;
  }
  return selection;
}

function computeEmphasis(
  diagram: Diagram,
  forkGroups: ReadonlyMap<string, DefaultDiagramEdge[]>,
  selection: CompositionSelection,
): Readonly<{ dimNodeIds: Set<string>; dimEdgeIds: Set<string> }> {
  const focusNodeIds = new Set<string>();
  const dimNodeIds = new Set<string>();
  for (const [forkId, edgeId] of Object.entries(selection)) {
    const forkEdges = forkGroups.get(forkId);
    const selectedEdge = forkEdges?.find(({ id }) => id === edgeId);
    if (!forkEdges || !selectedEdge) continue;
    for (const nodeId of collectReachableWithDepth(diagram.graph.edges, selectedEdge.target).nodeIds) {
      focusNodeIds.add(nodeId);
    }
    for (const edge of forkEdges) {
      if (edge.id === selectedEdge.id) continue;
      for (const nodeId of collectReachableWithDepth(diagram.graph.edges, edge.target).nodeIds) {
        dimNodeIds.add(nodeId);
      }
    }
  }
  for (const nodeId of focusNodeIds) dimNodeIds.delete(nodeId);
  const dimEdgeIds = new Set(
    diagram.graph.edges
      .filter(({ source, target }) => dimNodeIds.has(source) || dimNodeIds.has(target))
      .map(({ id }) => id),
  );
  return { dimNodeIds, dimEdgeIds };
}

function toEdgePath(placement: DiagramLayoutEdge): string {
  if (placement.routing === "spline") return toSplinePath(placement.points);
  if (placement.routing === "bezier") return toBezierPath(placement.points);
  return toPolylinePath(placement.points);
}

function buildCompositionPrototypeRenderModel(
  diagram: Diagram,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
  selection: CompositionSelection,
  onSelect: (selection: CompositionSelection) => void,
): DiagramReactFlowRenderModel {
  const forkGroups = collectForkGroups(diagram.graph.edges);
  const origins = collectOrigins(diagram.graph.edges);
  const emphasis = computeEmphasis(diagram, forkGroups, selection);
  const baseNodes = buildDiagramReactFlowNodes(diagram, layout, onOpenSource);
  const nodes = baseNodes.map((node) => {
    if (node.type !== "card") return node;
    const nodeOrigins = origins.get(node.id);
    return {
      ...node,
      ...(nodeOrigins ? { data: { ...node.data, details: [...(node.data.details ?? []), ...nodeOrigins] } } : {}),
      ...(emphasis.dimNodeIds.has(node.id) ? { style: { ...node.style, opacity: 0.2 } } : {}),
    };
  });

  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const representativeByForkId = new Map<string, string>();
  const placementByEdgeId = new Map<string, DiagramLayoutEdge>();
  const builtEdges: RouteReactFlowEdge[] = layout.edges.map((placement) => {
    const edge = diagram.graph.edges.find(({ id }) => id === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
    placementByEdgeId.set(edge.id, placement);
    const labelPosition =
      placement.points.length > 1
        ? getPolylineEdgeLabelPlacement(placement.points)
        : (placement.points.at(0) ?? { x: 0, y: 0 });
    const forkId = edge.type === "default" ? toForkId(edge) : undefined;
    if (forkId && forkGroups.has(forkId) && !representativeByForkId.has(forkId)) {
      representativeByForkId.set(forkId, edge.id);
    }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: DIAGRAM_EDGE_COLOR },
      style: {
        stroke: DIAGRAM_EDGE_COLOR,
        strokeWidth: 2,
        ...(emphasis.dimEdgeIds.has(edge.id) ? { opacity: 0.15 } : {}),
      },
      type: "route" as const,
      data: {
        path: toEdgePath(placement),
        labelPosition,
        ...(edge.type === "default" && edge.href ? { href: edge.href } : {}),
        onLinkActivate,
      },
    };
  });

  for (const [forkId, forkEdges] of forkGroups) {
    const representativeId = representativeByForkId.get(forkId);
    const representative = builtEdges.find(({ id }) => id === representativeId);
    const representativePlacement = representativeId ? placementByEdgeId.get(representativeId) : undefined;
    const sourceAnchor = representativePlacement?.points.at(0);
    if (!representative?.data || !sourceAnchor) continue;

    // Fork point: the shared anchor between branches (average of branch label
    // positions). Chips and branch paths both grow from here.
    const anchors = forkEdges
      .map(({ id }) => placementByEdgeId.get(id))
      .filter((placement): placement is DiagramLayoutEdge => placement != null)
      .map((placement) =>
        placement.points.length > 1
          ? getPolylineEdgeLabelPlacement(placement.points)
          : (placement.points.at(0) ?? { x: 0, y: 0 }),
      );
    const forkPoint = {
      x: anchors.reduce((sum, position) => sum + position.x, 0) / anchors.length,
      y: anchors.reduce((sum, position) => sum + position.y, 0) / anchors.length,
    };

    // Left-to-right chip order follows the branch target anchors.
    const branches = forkEdges
      .map((edge) => ({ edge, points: placementByEdgeId.get(edge.id)?.points }))
      .toSorted((a, b) => (a.points?.at(-1)?.x ?? 0) - (b.points?.at(-1)?.x ?? 0));

    for (const { edge, points } of branches) {
      const built = builtEdges.find(({ id }) => id === edge.id);
      if (!built?.data || !points) continue;
      let cut = -1;
      for (let index = 1; index < points.length; index += 1) {
        const point = points.at(index);
        if (point && point.y >= forkPoint.y - 1) {
          cut = index;
          break;
        }
      }
      const tail = cut === -1 ? [points.at(-1)!] : points.slice(cut);
      built.data = { ...built.data, path: toPolylinePath([forkPoint, ...tail]) };
    }

    // Single trunk from the source into the fork point; the branches above
    // continue from it, so the split visually starts at the toggle.
    builtEdges.push({
      ...representative,
      id: `${representative.id}::trunk`,
      markerEnd: undefined,
      style: { stroke: DIAGRAM_EDGE_COLOR, strokeWidth: 2 },
      data: { path: toPolylinePath([sourceAnchor, forkPoint]), labelPosition: forkPoint, onLinkActivate },
    });

    const optionLabels = toForkOptionLabels(
      diagram,
      branches.map(({ edge }) => edge),
    );
    representative.data = {
      ...representative.data,
      labelPosition: forkPoint,
      labelControl: (
        <ToggleGroup
          aria-label="Render path"
          onValueChange={(groupValue) => {
            const edgeId = groupValue.at(0);
            if (edgeId != null) onSelect({ ...selection, [forkId]: edgeId });
          }}
          size="sm"
          value={[selection[forkId] ?? branches.at(0)!.edge.id]}
          variant="outline"
        >
          {branches.map(({ edge }, index) => (
            <ToggleGroupItem key={edge.id} title={optionLabels.at(index)} value={edge.id}>
              {optionLabels.at(index)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ),
    };
  }

  return { nodes, edges: builtEdges };
}

function calculateCompositionLayout(diagram: Diagram, nodeSizes: DiagramNodeSizes) {
  if (diagram.layout.id !== "elk-layered") throw new Error("Expected an ELK layered diagram layout.");
  return layoutElkLayeredDiagram(diagram.graph, nodeSizes, diagram.layout.options);
}

export function ComponentCompositionPrototype(props: DiagramRendererProps) {
  const [selection, onSelect] = useState<CompositionSelection>(() => toDefaultSelection(props.diagram));
  const buildRenderModel = useCallback(
    (diagram: Diagram, layout: DiagramLayout, onOpenSource: (href: string) => void) =>
      buildCompositionPrototypeRenderModel(diagram, layout, onOpenSource, selection, onSelect),
    [selection],
  );

  return (
    <DiagramRendererBase {...props} calculateLayout={calculateCompositionLayout} buildRenderModel={buildRenderModel}>
      <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground shadow-sm">
        PROTOTYPE — busiest path active by default; switch branches on the fork toggle
      </div>
    </DiagramRendererBase>
  );
}
