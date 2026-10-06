import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import {
  routeConditionIncludesBranch,
  routeConditionText,
} from "@/client/widgets/component-structure-route-conditions";
import type { DefaultDiagramEdge, DiagramControl, DiagramEdge } from "@/features/diagram/diagram-graph";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";
import { RouteConditionLabel } from "@/shared/react-flow/route-condition-label";

const PROP_KIND_PATTERN = /^(\S+)\s+\((.+)\)$/;
// Merged cards carry the definition id while edges point at instances.
const INSTANCE_ID_SUFFIX = /@[0-9a-f]{16}$/;
export const toDefinitionId = (nodeId: string): string => nodeId.replace(INSTANCE_ID_SUFFIX, "");

// Same wording as the composition prototype: "from X (slot kind)" bullets live in
// the card details, while the edges themselves stay visually unlabeled.
function toKindSuffix(edge: DiagramEdge): string | undefined {
  if (!edge.kind) return undefined;
  const match = PROP_KIND_PATTERN.exec(edge.kind);
  const propType = match?.at(1);
  const slotName = match?.at(2);
  return propType != null && slotName != null ? `(${slotName} ${propType.toLowerCase()})` : undefined;
}

export function collectComponentOrigins(
  graph: Readonly<{
    nodes: readonly {
      id: string;
      type: string;
      component?: { origins?: readonly { supplierId: string; supplierTitle: string; prop: string }[] };
    }[];
    edges: readonly DiagramEdge[];
  }>,
): ReadonlyMap<string, readonly string[]> {
  // An incoming edge's kind names the slot the supplier used, e.g.
  // "NODE (children)" for children supplied as a node.
  const slotsBySupplier = new Map<string, Map<string, string>>();
  for (const edge of graph.edges) {
    if (edge.type !== "default") continue;
    const suffix = toKindSuffix(edge);
    if (!suffix) continue;
    const key = `${toDefinitionId(edge.target)}\0${toDefinitionId(edge.source)}`;
    const slots = slotsBySupplier.get(key) ?? new Map<string, string>();
    slots.set(suffix.slice(1, -1).split(" ").at(0)!, suffix);
    slotsBySupplier.set(key, slots);
  }
  const entriesByTarget = new Map<string, Set<string>>();
  const add = (target: string, entry: string) => {
    const known = entriesByTarget.get(target);
    if (known) known.add(entry);
    else entriesByTarget.set(target, new Set([entry]));
  };
  for (const node of graph.nodes) {
    const structured = node.type === "default" ? (node.component?.origins ?? []) : [];
    for (const origin of structured) {
      const suffix =
        slotsBySupplier.get(`${toDefinitionId(node.id)}\0${toDefinitionId(origin.supplierId)}`)?.get(origin.prop) ??
        `(${origin.prop})`;
      add(node.id, `from ${origin.supplierTitle} ${suffix}`);
    }
    if (structured.length > 0) continue;
    // Authored graphs can omit structured origins; fall back to edge labels.
    for (const edge of graph.edges) {
      if (edge.type !== "default" || edge.target !== node.id || !edge.label) continue;
      const slots = slotsBySupplier.get(`${edge.target}\0${edge.source}`);
      const suffix = [...(slots?.values() ?? [])].at(0);
      add(node.id, suffix ? `${edge.label} ${suffix}` : edge.label);
    }
  }
  return new Map([...entriesByTarget].map(([target, entries]) => [target, [...entries].toSorted()]));
}

type ComponentGuardLabelsProps = Readonly<{
  graph: Readonly<{ nodes: readonly { id: string; title?: string }[]; edges: readonly DiagramEdge[] }>;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  selection: ComponentSelection;
  onSelect: (edgeId: string, controlId: string, value: string) => void;
  onEdgeHover?: (edgeId: string | null) => void;
}>;

// A route's full activation condition rides one combined label. Branch arms
// (edges leaving a decision node) label near their start so the case reads
// beside the control that owns it; every other route labels near its arrival,
// growing back up the edge. Clicking the label applies that route's whole rule.
const ROUTE_CONDITION_ENDPOINT_OFFSET = 64;

export function attachGuardLabels({
  graph,
  controls,
  layout,
  edges,
  onSelect,
  onEdgeHover,
}: ComponentGuardLabelsProps): DiagramReactFlowEdge[] {
  const graphEdgeById = new Map(
    graph.edges.filter((edge): edge is DefaultDiagramEdge => edge.type === "default").map((edge) => [edge.id, edge]),
  );
  const pointsByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge.points]));
  const controlIds = new Set(controls.map((control) => control.id));
  return edges.map((edge) => {
    if (edge.type !== "route" || !edge.data) return edge;
    const graphEdge = graphEdgeById.get(edge.id);
    const guards = graphEdge?.guards;
    // Guards may hold only empty rules (an unconditional edge); those carry
    // no condition to state.
    if (!guards || !guards.some((rule) => rule.length > 0)) return edge;
    const points = pointsByEdgeId.get(edge.id) ?? [];
    const arc = polylineArcLength(points);
    const fallback = edge.data.labelPosition;
    const from = graphEdge != null && controlIds.has(graphEdge.source) ? "start" : "end";
    const offset = Math.min(ROUTE_CONDITION_ENDPOINT_OFFSET, arc / 2);
    const anchor = points.length < 2 ? (points.at(0) ?? fallback) : pointAlongPolyline(points, offset, from);
    const representative = guards.at(0)?.at(0);
    return {
      ...edge,
      data: {
        ...edge.data,
        labelControls: [
          {
            // Branch arms hang downstream of the start anchor; arrival labels
            // climb back up from the end anchor, each away from its node.
            anchorSide: from === "start" ? ("top" as const) : ("bottom" as const),
            control: (
              <div onMouseEnter={() => onEdgeHover?.(edge.id)} onMouseLeave={() => onEdgeHover?.(null)}>
                <RouteConditionLabel
                  includesBranch={routeConditionIncludesBranch(controls, guards)}
                  onSelect={() => {
                    if (representative) onSelect(edge.id, representative.controlId, representative.value);
                  }}
                  text={routeConditionText(controls, guards)}
                />
              </div>
            ),
            position: anchor,
          },
        ],
      },
    };
  });
}
