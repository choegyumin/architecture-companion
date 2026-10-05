import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import {
  estimateGuardLabelSize,
  type GuardLabelGroup,
  resolveGuardLabelOffsets,
} from "@/client/widgets/component-structure-guard-collision";
import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import type { DefaultDiagramEdge, DiagramControl, DiagramEdge } from "@/features/diagram/diagram-graph";
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

type ComponentGuardLabelsProps = Readonly<{
  graph: Readonly<{ nodes: readonly { id: string; title?: string }[]; edges: readonly DiagramEdge[] }>;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  selection: ComponentSelection;
  onSelect: (edgeId: string, controlId: string, value: string) => void;
}>;

// Guard pills hug the edge end that decides them: branch cases leave with the
// edge's start, conditional toggles arrive with its end. Edges too short to
// separate both groups merge them in start-to-end order at the start anchor.
const GUARD_LABEL_ENDPOINT_OFFSET = 64;
const GUARD_LABEL_MIN_SEPARATION = 96;

type ProjectedGuardGroup = GuardLabelGroup & Readonly<{ rules: readonly (readonly GuardPill[])[] }>;

// // control stay in sync because selection is keyed by control. Clicking any
// pill requests its whole edge's path, not a single condition.
export function attachGuardLabels({
  graph,
  controls,
  layout,
  edges,
  selection,
  onSelect,
}: ComponentGuardLabelsProps): DiagramReactFlowEdge[] {
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const graphEdgeById = new Map(
    graph.edges.filter((edge): edge is DefaultDiagramEdge => edge.type === "default").map((edge) => [edge.id, edge]),
  );
  // Projects one pill per requirement, keeping each guard rule together: an
  // AND rule renders as one box, and OR rules stay separate units.
  const rulesOf = (edgeId: string): { branch: GuardPill[][]; conditional: GuardPill[][]; all: GuardPill[][] } => {
    const guards = graphEdgeById.get(edgeId)?.guards;
    if (!guards) return { branch: [], conditional: [], all: [] };
    const branch: GuardPill[][] = [];
    const conditional: GuardPill[][] = [];
    const all: GuardPill[][] = [];
    for (const [ruleIndex, guardRule] of guards.entries()) {
      const branchRule: GuardPill[] = [];
      const conditionalRule: GuardPill[] = [];
      const rule: GuardPill[] = [];
      const seen = new Set<string>();
      for (const { controlId, value } of guardRule) {
        const key = `${controlId}\0${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const control = controlsById.get(controlId);
        if (!control) continue;
        const pill =
          control.kind === "branch"
            ? {
                id: `${ruleIndex}:${key}`,
                kind: "branch" as const,
                label: control.cases.find((branchCase) => branchCase.id === value)?.label ?? value,
                pressed: selection[controlId] === value,
                onSelect: () => onSelect(edgeId, controlId, value),
              }
            : {
                id: `${ruleIndex}:${key}`,
                kind: "conditional" as const,
                label: control.label,
                pressed: selection[controlId] === value,
                onSelect: () => onSelect(edgeId, controlId, value),
              };
        rule.push(pill);
        (control.kind === "branch" ? branchRule : conditionalRule).push(pill);
      }
      if (rule.length > 0) all.push(rule);
      if (branchRule.length > 0) branch.push(branchRule);
      if (conditionalRule.length > 0) conditional.push(conditionalRule);
    }
    return { branch, conditional, all };
  };
  const pointsByEdgeId = new Map(layout.edges.map((edge) => [edge.id, edge.points]));
  const anchorAlong = (
    points: readonly { x: number; y: number }[],
    fallback: { x: number; y: number },
    offset: number,
    from: "start" | "end",
  ) => (points.length < 2 ? (points.at(0) ?? fallback) : pointAlongPolyline(points, offset, from));

  // First pass: project each edge's guards into anchored rule groups.
  const groupsByEdge = new Map<string, ProjectedGuardGroup[]>();
  for (const edge of edges) {
    if (edge.type !== "route" || !edge.data) continue;
    const { branch, conditional, all } = rulesOf(edge.id);
    if (all.length === 0) continue;
    const points = pointsByEdgeId.get(edge.id) ?? [];
    const arc = polylineArcLength(points);
    const fallback = edge.data.labelPosition;
    const separated =
      branch.length > 0 &&
      conditional.length > 0 &&
      arc >= 2 * GUARD_LABEL_ENDPOINT_OFFSET + GUARD_LABEL_MIN_SEPARATION;
    const entries = separated
      ? [
          { from: "start" as const, rules: branch, offset: GUARD_LABEL_ENDPOINT_OFFSET },
          { from: "end" as const, rules: conditional, offset: GUARD_LABEL_ENDPOINT_OFFSET },
        ]
      : [
          {
            // Never anchor past the midpoint, so pills on short edges stay on
            // the edge instead of clamping onto the node at the far end.
            from: (branch.length > 0 ? "start" : "end") as "start" | "end",
            rules: all,
            offset: Math.min(GUARD_LABEL_ENDPOINT_OFFSET, arc / 2),
          },
        ];
    groupsByEdge.set(
      edge.id,
      entries.map((entry) => ({
        edgeId: edge.id,
        from: entry.from,
        rules: entry.rules,
        offset: entry.offset,
        points,
        fallback,
        size: estimateGuardLabelSize(entry.rules),
      })),
    );
  }

  // Second pass: push colliding labels away from node cards and each other.
  const obstacles = layout.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.size.width,
    height: node.size.height,
  }));
  const offsets = resolveGuardLabelOffsets([...groupsByEdge.values()].flat(), obstacles);

  return edges.map((edge) => {
    if (edge.type !== "route" || !edge.data) return edge;
    const groups = groupsByEdge.get(edge.id);
    if (!groups) return edge;
    const labelControls = groups.map((group) => ({
      control: <GuardEdgeLabel rules={group.rules} />,
      position: anchorAlong(
        group.points,
        group.fallback,
        offsets.get(`${group.edgeId}\0${group.from}`) ?? group.offset,
        group.from,
      ),
    }));
    return {
      ...edge,
      data: {
        ...edge.data,
        labelControls,
      },
    };
  });
}
