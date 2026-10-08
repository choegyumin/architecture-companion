import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import { estimateGuardLabelSize, resolveGuardLabelOffsets } from "@/client/widgets/component-structure-guard-collision";
import {
  routeConditionIncludesBranch,
  routeConditionText,
} from "@/client/widgets/component-structure-route-conditions";
import type { ProjectedComponentStructureGraph } from "@/features/diagram/decision-nodes";
import type { DiagramControl } from "@/features/diagram/diagram-graph";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { clearEdgeHighlight, reportEdgeHighlight } from "@/shared/react-flow/edge-highlight";
import { GuardEdgeLabel } from "@/shared/react-flow/guard-edge-label";
import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";

// "from X (slot)" bullets live in the card details, derived from the stored
// component origins; authored graphs without structured origins fall back to
// the incoming edge labels.
export function collectComponentOrigins(
  graph: Readonly<{
    nodes: ProjectedComponentStructureGraph["nodes"];
    edges: readonly Readonly<{ target: string; source: string; label?: string }>[];
  }>,
): ReadonlyMap<string, readonly string[]> {
  const entriesByTarget = new Map<string, Set<string>>();
  const add = (target: string, entry: string) => {
    const known = entriesByTarget.get(target);
    if (known) known.add(entry);
    else entriesByTarget.set(target, new Set([entry]));
  };
  for (const node of graph.nodes) {
    const structured = node.type === "default" ? (node.component?.origins ?? []) : [];
    for (const origin of structured) {
      add(node.id, `from ${origin.supplierTitle} (${origin.prop})`);
    }
    if (structured.length > 0) continue;
    for (const edge of graph.edges) {
      if (edge.target !== node.id || !edge.label) continue;
      add(node.id, edge.label);
    }
  }
  return new Map([...entriesByTarget].map(([target, entries]) => [target, [...entries].toSorted()]));
}

type ComponentGuardLabelsProps = Readonly<{
  graph: ProjectedComponentStructureGraph;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  /** Routes whose condition holds under the current selection — their icon stays lit. */
  activeEdges: ReadonlySet<string>;
  onSelect: (edgeId: string, controlId: string, value: string) => void;
}>;

// A route's full activation condition rides one combined label. Branch arms
// (edges leaving a decision node) label near their start so the case reads
// beside the control that owns it; every other route labels near its arrival,
// growing back up the edge. Clicking the label applies that route's whole rule;
// highlighting reports into the shared channel, and the canvas decides what lights.
const GUARD_LABEL_ENDPOINT_OFFSET = 64;

export function attachGuardLabels({
  graph,
  controls,
  layout,
  edges,
  activeEdges,
  onSelect,
}: ComponentGuardLabelsProps): DiagramReactFlowEdge[] {
  const graphEdgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const pointsByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge.points]));
  const controlIds = new Set(controls.map((control) => control.id));
  // Route-bearing edges get one combined label; the decoration pass below
  // needs the anchor for each, so collect them first.
  const labeled = edges.flatMap((edge) => {
    if (edge.type !== "route" || !edge.data) return [];
    const graphEdge = graphEdgeById.get(edge.id);
    const guards = graphEdge?.guards;
    // Guards may hold only empty rules (an unconditional edge); those carry
    // no condition to state.
    if (!guards || !guards.some((rule) => rule.length > 0)) return [];
    const points = pointsByEdgeId.get(edge.id) ?? [];
    const arc = polylineArcLength(points);
    const from: "start" | "end" = graphEdge != null && controlIds.has(graphEdge.source) ? "start" : "end";
    const text = routeConditionText(controls, guards);
    return [
      {
        edge,
        guards,
        from,
        offset: Math.min(GUARD_LABEL_ENDPOINT_OFFSET, arc / 2),
        points,
        text,
      },
    ];
  });
  // Labels sharing an anchor region — same-branch arms especially — resolve
  // by pushing along their own edge, away from the node they leave or reach.
  const resolved = resolveGuardLabelOffsets(
    labeled.map(({ edge, from, offset, points, text }) => ({
      edgeId: edge.id,
      from,
      offset,
      points,
      fallback: edge.data!.labelPosition,
      size: estimateGuardLabelSize(text),
    })),
    layout.nodes.map((node) => ({ x: node.position.x, y: node.position.y, ...node.size })),
  );
  return edges.map((edge) => {
    const label = labeled.find((item) => item.edge.id === edge.id);
    if (!label || edge.type !== "route" || !edge.data) return edge;
    const anchor =
      label.points.length < 2
        ? (label.points.at(0) ?? edge.data.labelPosition)
        : pointAlongPolyline(label.points, resolved.get(`${edge.id}\0${label.from}`) ?? label.offset, label.from);
    const representative = label.guards.at(0)?.at(0);
    return {
      ...edge,
      data: {
        ...edge.data,
        labelControls: [
          {
            // Branch arms hang downstream of the start anchor; arrival labels
            // climb back up from the end anchor, each away from its node.
            anchorSide: label.from === "start" ? ("top" as const) : ("bottom" as const),
            control: (
              <GuardEdgeLabel
                active={activeEdges.has(edge.id)}
                includesBranch={routeConditionIncludesBranch(controls, label.guards)}
                onSelect={() => {
                  if (representative) onSelect(edge.id, representative.controlId, representative.value);
                }}
                onHighlightChange={(highlighted) => {
                  if (highlighted) reportEdgeHighlight({ kind: "label", edgeId: edge.id });
                  else clearEdgeHighlight({ kind: "label", edgeId: edge.id });
                }}
                text={label.text}
              />
            ),
            position: anchor,
          },
        ],
      },
    };
  });
}
