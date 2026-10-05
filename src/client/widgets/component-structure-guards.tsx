import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import type {
  DefaultDiagramEdge,
  DiagramControl,
  DiagramControlCondition,
  DiagramEdge,
} from "@/features/diagram/diagram-graph";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { GuardEdgeLabel, type GuardPill } from "@/shared/react-flow/guard-edge-label";
import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";

const PROP_KIND_PATTERN = /^(\S+)\s+\((.+)\)$/;
// Merged cards carry the definition id while edges point at instances.
const INSTANCE_ID_SUFFIX = /@[0-9a-f]{16}$/;
const toDefinitionId = (nodeId: string): string => nodeId.replace(INSTANCE_ID_SUFFIX, "");

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

type ComponentGuardEmphasis = Readonly<{
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  controls: ReadonlySet<string>;
}>;

type ComponentGuardLabelsProps = Readonly<{
  graph: Readonly<{ nodes: readonly { id: string; title?: string }[]; edges: readonly DiagramEdge[] }>;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  selection: ComponentSelection;
  emphasis: ComponentGuardEmphasis;
  onSelect: (controlId: string, value: string) => void;
}>;

// Guard pills hug the edge end that decides them: branch cases leave with the
// edge's start, conditional toggles arrive with its end. Edges too short to
// separate both groups merge them in start-to-end order at the start anchor.
const GUARD_LABEL_ENDPOINT_OFFSET = 64;
const GUARD_LABEL_MIN_SEPARATION = 96;

// Projects one guard pill per condition an edge's guards name. All pills of a
// control stay in sync because selection is keyed by control: clicking any
// projection of the same guard applies the same choice everywhere.
export function attachGuardLabels({
  graph,
  controls,
  layout,
  edges,
  selection,
  emphasis,
  onSelect,
}: ComponentGuardLabelsProps): DiagramReactFlowEdge[] {
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const graphEdgeById = new Map(
    graph.edges.filter((edge): edge is DefaultDiagramEdge => edge.type === "default").map((edge) => [edge.id, edge]),
  );
  const pillsOf = (edgeId: string): { branch: GuardPill[]; conditional: GuardPill[] } => {
    const guards = graphEdgeById.get(edgeId)?.guards;
    if (!guards) return { branch: [], conditional: [] };
    const seen = new Set<string>();
    const branch: GuardPill[] = [];
    const conditional: GuardPill[] = [];
    for (const path of guards) {
      for (const { controlId, value } of path as DiagramControlCondition[]) {
        const key = `${controlId}\0${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const control = controlsById.get(controlId);
        if (!control) continue;
        const active = emphasis.controls.has(controlId);
        const description = active ? "Active path" : "Inactive path; selecting activates ancestors";
        const pill =
          control.kind === "branch"
            ? {
                id: key,
                label: control.cases.find((branchCase) => branchCase.id === value)?.label ?? value,
                pressed: selection[controlId] === value,
                active,
                description,
                onSelect: () => onSelect(controlId, value),
              }
            : {
                id: key,
                label: control.label,
                pressed: selection[controlId] === value,
                active,
                description,
                onSelect: () => onSelect(controlId, selection[controlId] === "on" ? "off" : "on"),
              };
        (control.kind === "branch" ? branch : conditional).push(pill);
      }
    }
    return { branch, conditional };
  };
  const pointsByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge.points]));
  // Never anchor past the edge's midpoint, so pills on short edges stay on the
  // edge instead of clamping onto the node at the far end.
  const anchorAlong = (
    points: readonly { x: number; y: number }[],
    fallback: { x: number; y: number },
    from: "start" | "end",
  ) =>
    points.length < 2
      ? (points.at(0) ?? fallback)
      : pointAlongPolyline(points, Math.min(GUARD_LABEL_ENDPOINT_OFFSET, polylineArcLength(points) / 2), from);

  return edges.map((edge) => {
    if (edge.type !== "route" || !edge.data) return edge;
    const { branch, conditional } = pillsOf(edge.id);
    if (branch.length === 0 && conditional.length === 0) return edge;
    const points = pointsByEdgeId.get(edge.id) ?? [];
    const separated =
      branch.length > 0 &&
      conditional.length > 0 &&
      polylineArcLength(points) >= 2 * GUARD_LABEL_ENDPOINT_OFFSET + GUARD_LABEL_MIN_SEPARATION;
    const labelControls = separated
      ? [
          {
            control: <GuardEdgeLabel pills={branch} />,
            position: anchorAlong(points, edge.data.labelPosition, "start"),
          },
          {
            control: <GuardEdgeLabel pills={conditional} />,
            position: anchorAlong(points, edge.data.labelPosition, "end"),
          },
        ]
      : [
          {
            control: <GuardEdgeLabel pills={[...branch, ...conditional]} />,
            position: anchorAlong(points, edge.data.labelPosition, branch.length > 0 ? "start" : "end"),
          },
        ];
    return {
      ...edge,
      data: {
        ...edge.data,
        labelControls,
      },
    };
  });
}
