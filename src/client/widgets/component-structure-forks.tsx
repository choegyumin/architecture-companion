import type { ReactNode } from "react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import { DIAGRAM_EDGE_COLOR } from "@/client/widgets/diagram-renderer.react-flow";
import { toPolylinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";
import type { DefaultDiagramEdge, DiagramControl, DiagramEdge } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutEdge, DiagramLayoutPoint } from "@/features/diagram/diagram-spatial";
import { BranchEdgeLabel } from "@/shared/react-flow/branch-edge-label";
import { ConditionalEdgeLabel } from "@/shared/react-flow/conditional-edge-label";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

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

type ComponentForkEmphasis = Readonly<{
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  controls: ReadonlySet<string>;
}>;

type ComponentControlForksProps = Readonly<{
  graph: Readonly<{ nodes: readonly { id: string; title?: string }[]; edges: readonly DiagramEdge[] }>;
  controls: readonly DiagramControl[];
  layout: DiagramLayout;
  edges: readonly DiagramReactFlowEdge[];
  selection: ComponentSelection;
  emphasis: ComponentForkEmphasis;
  onSelect: (controlId: string, value: string) => void;
}>;

function toLabelPlacement(placement: DiagramLayoutEdge | undefined): DiagramLayoutPoint | undefined {
  if (!placement) return undefined;
  return placement.points.length > 1
    ? getPolylineEdgeLabelPlacement(placement.points)
    : (placement.points.at(0) ?? { x: 0, y: 0 });
}

// Renders each control as a chip at a fork between the control source and the
// alternative paths. Layout input stays untouched, so the layered edges keep
// their straightened routing; only the drawn paths are re-anchored to the fork.
export function applyComponentControlForks({
  graph,
  controls,
  layout,
  edges,
  selection,
  emphasis,
  onSelect,
}: ComponentControlForksProps): DiagramReactFlowEdge[] {
  const placementByEdgeId = new Map(layout.edges.map((placement) => [placement.id, placement]));
  // Chips accumulate: several controls can fork the same source edge, so every
  // write reads the latest built edge instead of the pre-surgery model.
  const byEdgeId = new Map<string, DiagramReactFlowEdge>();
  for (const edge of edges) byEdgeId.set(edge.id, edge);
  const trunks: DiagramReactFlowEdge[] = [];

  // A control value is alive when any edge in the graph requires it, not just
  // the fork it cuts: pass-through controls gate deeper edges only.
  const alivePairs = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== "default") continue;
    for (const path of edge.activeWhen ?? []) {
      for (const { controlId, value } of path) alivePairs.add(`${controlId}\0${value}`);
    }
  }

  // Chips whose footprints overlap share one anchor edge: the label control
  // stacks its children vertically, while separate anchor edges at the same
  // point would render on top of each other. Footprints come from the label
  // text (text-xs) plus control chrome, since chips build before the DOM can
  // measure them.
  const chipStacks: { edgeId: string; position: DiagramLayoutPoint; halfWidth: number }[] = [];
  const chipStackAnchorFor = (
    control: DiagramControl,
    edgeId: string,
    position: DiagramLayoutPoint,
  ): { edgeId: string; position: DiagramLayoutPoint } => {
    const halfWidth =
      (control.kind === "branch"
        ? control.cases.reduce((sum, option) => sum + 7 * option.label.length + 20, 8)
        : 7 * control.label.length + 44) / 2;
    const near = chipStacks.find(
      (stack) =>
        Math.abs(stack.position.x - position.x) < stack.halfWidth + halfWidth + 8 &&
        Math.abs(stack.position.y - position.y) < 45,
    );
    if (near) return near;
    const stack = { edgeId, position, halfWidth };
    chipStacks.push(stack);
    return stack;
  };

  const attachChip = (edgeId: string, position: DiagramLayoutPoint, chip: ReactNode): void => {
    const current = byEdgeId.get(edgeId);
    if (current?.type !== "route" || !current.data) return;
    byEdgeId.set(edgeId, {
      ...current,
      data: {
        ...current.data,
        labelPosition: position,
        labelControl: (
          <>
            {current.data.labelControl}
            {chip}
          </>
        ),
      },
    });
  };

  const titleByNode = new Map(graph.nodes.map((node) => [node.id, node.title]));

  const meanLabelPosition = (edges: readonly DefaultDiagramEdge[]): DiagramLayoutPoint | undefined => {
    const placements = edges
      .map((edge) => toLabelPlacement(placementByEdgeId.get(edge.id)))
      .filter((position): position is DiagramLayoutPoint => position != null);
    if (!placements.length) return undefined;
    return {
      x: placements.reduce((sum, position) => sum + position.x, 0) / placements.length,
      y: placements.reduce((sum, position) => sum + position.y, 0) / placements.length,
    };
  };

  type ControlFacts = Readonly<{
    control: DiagramControl;
    outgoing: readonly DefaultDiagramEdge[];
    memberEdges: readonly DefaultDiagramEdge[];
    // Edges this control cuts into a fork: a branch edge belongs to exactly
    // one of its cases; edges reachable under several cases stay whole.
    branchEdges: readonly DefaultDiagramEdge[];
  }>;
  const factOf = (control: DiagramControl): ControlFacts => {
    const outgoing = graph.edges.filter(
      (edge): edge is DefaultDiagramEdge =>
        edge.source === control.owner && edge.type === "default" && byEdgeId.get(edge.id)?.type === "route",
    );
    const memberEdges = outgoing.filter((edge) =>
      (edge.activeWhen ?? []).some((path) => path.some(({ controlId }) => controlId === control.id)),
    );
    const branchEdges =
      control.kind === "branch"
        ? memberEdges.filter((edge) => {
            const values = new Set(
              (edge.activeWhen ?? [])
                .flatMap((path) => path.filter(({ controlId }) => controlId === control.id))
                .map(({ value }) => value),
            );
            return values.size === 1 && control.cases.some(({ id }) => values.has(id));
          })
        : [];
    return { control, outgoing, memberEdges, branchEdges };
  };
  // A when-only control can sit on a source without outgoing edges; anchor
  // its chip on an incoming edge so it stays reachable next to its source.
  const anchorEdgesFor = (
    fact: ControlFacts,
    primary: readonly DefaultDiagramEdge[],
  ): readonly DefaultDiagramEdge[] => {
    if (primary.length) return primary;
    if (fact.outgoing.length) return fact.outgoing;
    return graph.edges.filter(
      (edge): edge is DefaultDiagramEdge =>
        edge.target === fact.control.owner && edge.type === "default" && byEdgeId.get(edge.id)?.type === "route",
    );
  };

  const facts = controls.map(factOf);
  // Branch controls that cut the same owner's edges render as ONE integrated
  // fork chip: their conditions combine to pick the edge, so the chip's
  // options are the combinations themselves. The first control in declaration
  // order leads the group.
  const groupLeadIndexByOwner = new Map<string, number>();
  for (const [index, fact] of facts.entries()) {
    if (fact.control.kind !== "branch" || !fact.branchEdges.length) continue;
    if (!groupLeadIndexByOwner.has(fact.control.owner)) groupLeadIndexByOwner.set(fact.control.owner, index);
  }

  for (const [index, fact] of facts.entries()) {
    const { control } = fact;
    const active = emphasis.controls.has(control.id);
    const description = active ? "Active path" : "Inactive path; selecting activates ancestors";

    // A conditional guard wraps a single rendering path, not a fork: its chip
    // rides the guarded edge and the routing stays as the layout made it.
    if (control.kind !== "branch") {
      const chip = (
        <ConditionalEdgeLabel
          active={active}
          description={description}
          label={control.label}
          onToggle={() => onSelect(control.id, selection[control.id] === "on" ? "off" : "on")}
          pressed={selection[control.id] === "on"}
        />
      );
      const anchorEdges = anchorEdgesFor(fact, fact.memberEdges);
      const position = meanLabelPosition(anchorEdges);
      if (position) {
        const stack = chipStackAnchorFor(control, anchorEdges.at(0)!.id, position);
        attachChip(stack.edgeId, stack.position, chip);
      }
      continue;
    }

    if (!fact.branchEdges.length) {
      // The control guards deeper edges only: keep the chip on the source's
      // first outgoing edge without re-anchoring its path.
      const anchorEdges = anchorEdgesFor(fact, fact.memberEdges);
      const forkPoint = meanLabelPosition(anchorEdges);
      if (!forkPoint) continue;
      const chip = (
        <BranchEdgeLabel
          description={description}
          label={control.label}
          onSelect={(value) => onSelect(control.id, value)}
          options={control.cases.map((authoredCase) => ({
            ...authoredCase,
            disabled: !alivePairs.has(`${control.id}\0${authoredCase.id}`),
          }))}
          value={selection[control.id] ?? control.cases.at(0)!.id}
        />
      );
      const stack = chipStackAnchorFor(control, anchorEdges.at(0)!.id, forkPoint);
      attachChip(stack.edgeId, stack.position, chip);
      continue;
    }

    // Non-lead group members render with the lead's integrated chip.
    if (groupLeadIndexByOwner.get(control.owner) !== index) continue;

    const group = facts.filter(
      (member): member is ControlFacts & { control: DiagramControl & { kind: "branch" } } =>
        member.control.kind === "branch" && member.branchEdges.length > 0 && member.control.owner === control.owner,
    );
    const forkEdges = [
      ...new Map(group.flatMap((member) => member.branchEdges).map((edge) => [edge.id, edge])).values(),
    ];
    const forkPoint = meanLabelPosition(forkEdges);
    if (!forkPoint) continue;

    // One option per distinct condition combination over the fork's edges, so
    // an option maps onto the edges it activates (options ↔ edges, with two
    // edges under one combination counted as that option's exits).
    type ForkOption = { id: string; assignment: Map<string, string>; edges: DefaultDiagramEdge[] };
    const optionsByKey = new Map<string, ForkOption>();
    for (const edge of forkEdges) {
      const assignment = new Map<string, string>();
      for (const member of group) {
        const values = new Set(
          (edge.activeWhen ?? [])
            .flatMap((path) => path.filter(({ controlId }) => controlId === member.control.id))
            .map(({ value }) => value),
        );
        if (values.size === 1) assignment.set(member.control.id, values.values().next().value!);
      }
      const key = [...assignment]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([controlId, value]) => `${controlId}=${value}`)
        .join("&");
      const existing = optionsByKey.get(key);
      if (existing) existing.edges.push(edge);
      else optionsByKey.set(key, { id: key, assignment, edges: [edge] });
    }

    // Labels show only the controls that vary between options; controls held
    // at one value across the whole fork are constants, not choices.
    const reference = optionsByKey.values().next().value as ForkOption;
    const varying = group
      .map((member) => member.control)
      .filter((member) =>
        [...optionsByKey.values()].some(
          (option) => option.assignment.get(member.id) !== reference.assignment.get(member.id),
        ),
      );
    const caseLabelOf = (controlId: string, value: string): string => {
      const member = group.find((candidate) => candidate.control.id === controlId)!.control;
      return member.cases.find((authoredCase) => authoredCase.id === value)?.label ?? value;
    };
    const labelOf = (option: ForkOption): string => {
      const constrained = varying.filter((member) => option.assignment.has(member.id));
      const labelControls = constrained.length
        ? constrained
        : group.map((member) => member.control).filter((member) => option.assignment.has(member.id));
      return (
        labelControls.map((member) => caseLabelOf(member.id, option.assignment.get(member.id)!)).join(" && ") ||
        "default"
      );
    };
    const rankOf = (option: ForkOption): [number, number] | undefined => {
      let best: [number, number] | undefined;
      for (const edge of option.edges) {
        const point = placementByEdgeId.get(edge.id)?.points.at(-1);
        if (!point) continue;
        const [bestX, bestY] = best ?? [];
        if (bestX == null || bestY == null || point.x < bestX || (point.x === bestX && point.y < bestY)) {
          best = [point.x, point.y];
        }
      }
      return best;
    };
    // Alive options follow the drawn port order — leftmost target anchor
    // first — so the first button matches the leftmost exit. Ranking compares
    // each option's leftmost edge only: an option owning several edges is not
    // guaranteed a contiguous span of exits (the layout knows nothing about
    // the options), and we accept that rather than regrouping drawn ports.
    const alive = [...optionsByKey.values()]
      .map((option, order) => ({ option, order, rank: rankOf(option) }))
      .toSorted((left, right) => {
        if (left.rank != null && right.rank != null) {
          const [leftX, leftY] = left.rank;
          const [rightX, rightY] = right.rank;
          return leftX - rightX || leftY - rightY;
        }
        if (left.rank != null) return -1;
        if (right.rank != null) return 1;
        return left.order - right.order;
      })
      .map(({ option }) => option);

    // A case value no edge in the graph requires renders no component path:
    // keep the branch visible as a disabled option instead of hiding it.
    // Values alive only on deeper edges stay out of the fork chip — they act
    // below this fork. Boundary: values alive individually but dead only as a
    // combination are not detected — this covers whole dead arms (early
    // returns), not partial combination coverage.
    const dead: { id: string; label: string; assignment: [string, string][] }[] = [];
    for (const member of group) {
      for (const authoredCase of member.control.cases) {
        if (alivePairs.has(`${member.control.id}\0${authoredCase.id}`)) continue;
        dead.push({
          id: `${member.control.id}::${authoredCase.id}`,
          label: authoredCase.label,
          assignment: [[member.control.id, authoredCase.id]],
        });
      }
    }

    const assignmentById = new Map(alive.map((option) => [option.id, [...option.assignment] as [string, string][]]));
    for (const option of dead) assignmentById.set(option.id, option.assignment);
    const chipOptions = [
      ...alive.map((option) => ({ id: option.id, label: labelOf(option) })),
      ...dead.map((option) => ({ id: option.id, label: option.label, disabled: true })),
    ];
    const selectionMatches = (assignment: readonly (readonly [string, string])[]): boolean =>
      assignment.every(([controlId, value]) => selection[controlId] === value);
    const matched =
      alive.find((option) => selectionMatches([...option.assignment])) ??
      dead.find((option) => selectionMatches(option.assignment));
    // The pressed option can still be inactive when ancestors gate it, so the
    // description reports emphasis, not the selection match.
    const groupActive = group.every((member) => emphasis.controls.has(member.control.id));
    const chip = (
      <BranchEdgeLabel
        description={groupActive ? "Active path" : "Inactive path; selecting activates ancestors"}
        label={titleByNode.get(control.owner) ?? control.owner}
        onSelect={(value) => {
          for (const [controlId, caseValue] of assignmentById.get(value) ?? []) onSelect(controlId, caseValue);
        }}
        options={chipOptions}
        value={matched?.id ?? chipOptions.at(0)!.id}
      />
    );

    // Left-to-right branch order follows the branch target anchors.
    const branches = forkEdges
      .map((edge) => ({ edge, points: placementByEdgeId.get(edge.id)?.points }))
      .toSorted((left, right) => (left.points?.at(-1)?.x ?? 0) - (right.points?.at(-1)?.x ?? 0));
    for (const { edge, points } of branches) {
      if (!points) continue;
      let cut = -1;
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const point = points.at(pointIndex);
        if (point && point.y >= forkPoint.y - 1) {
          cut = pointIndex;
          break;
        }
      }
      const tail = cut === -1 ? [points.at(-1)!] : points.slice(cut);
      const routed = byEdgeId.get(edge.id);
      if (routed?.type !== "route" || !routed.data) continue;
      byEdgeId.set(edge.id, { ...routed, data: { ...routed.data, path: toPolylinePath([forkPoint, ...tail]) } });
    }

    const representative = branches.at(0)!.edge;
    const representativeBuilt = byEdgeId.get(representative.id);
    const sourceAnchor = placementByEdgeId.get(representative.id)?.points.at(0);
    if (representativeBuilt?.type !== "route" || !representativeBuilt.data || !sourceAnchor) continue;
    const { label: trunkLabel, ...trunkEdge } = representativeBuilt;
    void trunkLabel;
    trunks.push({
      ...trunkEdge,
      id: `${representative.id}::${control.id}::trunk`,
      // The cut branch keeps the connection's accessible name; the trunk gets
      // its own so screen readers do not announce the same name twice.
      ariaLabel: `${representative.source} to ${representative.target}: Control path trunk`,
      markerEnd: undefined,
      style: {
        stroke: DIAGRAM_EDGE_COLOR,
        strokeWidth: 2,
        opacity: emphasis.edges.has(representative.id) ? 1 : 0.25,
      },
      data: { path: toPolylinePath([sourceAnchor, forkPoint]), labelPosition: forkPoint },
    });
    const stack = chipStackAnchorFor(control, representative.id, forkPoint);
    attachChip(stack.edgeId, stack.position, chip);
  }

  return [...edges.map((edge) => byEdgeId.get(edge.id) ?? edge), ...trunks];
}
