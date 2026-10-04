import type { ReactNode } from "react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import { DIAGRAM_EDGE_COLOR } from "@/client/widgets/diagram-renderer.react-flow";
import { toPolylinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";
import type { ComponentControl, DefaultDiagramEdge, DiagramEdge } from "@/features/diagram/diagram-graph";
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
  graph: Readonly<{ nodes: readonly unknown[]; edges: readonly DiagramEdge[] }>;
  componentStructure: Readonly<{
    controls: readonly ComponentControl[];
  }>;
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
  componentStructure,
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

  for (const control of componentStructure.controls) {
    const active = emphasis.controls.has(control.id);
    const description = active ? "Active path" : "Inactive path; selecting activates ancestors";
    const chip =
      control.kind === "branch" ? (
        <BranchEdgeLabel
          description={description}
          label={control.label}
          onSelect={(value) => onSelect(control.id, value)}
          options={control.alternatives}
          value={selection[control.id] ?? control.alternatives.at(0)!.id}
        />
      ) : (
        <ConditionalEdgeLabel
          active={active}
          description={description}
          label={control.label}
          onToggle={() => onSelect(control.id, selection[control.id] === "on" ? "off" : "on")}
          pressed={selection[control.id] === "on"}
        />
      );
    const outgoing = graph.edges.filter(
      (edge): edge is DefaultDiagramEdge =>
        edge.source === control.source && edge.type === "default" && byEdgeId.get(edge.id)?.type === "route",
    );
    const mentionsControl = (edge: DefaultDiagramEdge) =>
      (edge.component?.paths ?? []).some((path) => path.some(({ controlId }) => controlId === control.id));
    const memberEdges = outgoing.filter(mentionsControl);
    // A when-only control can sit on a source without outgoing edges; anchor
    // its chip on an incoming edge so it stays reachable next to its source.
    const anchorEdgesFor = (primary: readonly DefaultDiagramEdge[]): readonly DefaultDiagramEdge[] => {
      if (primary.length) return primary;
      if (outgoing.length) return outgoing;
      return graph.edges.filter(
        (edge): edge is DefaultDiagramEdge =>
          edge.target === control.source && edge.type === "default" && byEdgeId.get(edge.id)?.type === "route",
      );
    };
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

    // A conditional guard wraps a single rendering path, not a fork: its chip
    // rides the guarded edge and the routing stays as the layout made it.
    if (control.kind !== "branch") {
      const anchorEdges = anchorEdgesFor(memberEdges);
      const position = meanLabelPosition(anchorEdges);
      if (position) attachChip(anchorEdges.at(0)!.id, position, chip);
      continue;
    }

    // A branch edge belongs to one alternative only; edges reachable under
    // several alternatives stay whole and never get cut.
    const branchEdges = memberEdges.filter((edge) => {
      const values = new Set(
        (edge.component?.paths ?? [])
          .flatMap((path) => path.filter(({ controlId }) => controlId === control.id))
          .map(({ value }) => value),
      );
      return values.size === 1 && control.alternatives.some(({ id }) => values.has(id));
    });

    const anchorEdges = anchorEdgesFor(branchEdges);
    const forkPoint = meanLabelPosition(anchorEdges);
    if (!forkPoint) continue;

    if (!branchEdges.length) {
      // The control guards deeper edges only: keep the chip on the source's
      // first outgoing edge without re-anchoring its path.
      attachChip(anchorEdges.at(0)!.id, forkPoint, chip);
      continue;
    }

    // Left-to-right branch order follows the branch target anchors.
    const branches = branchEdges
      .map((edge) => ({ edge, points: placementByEdgeId.get(edge.id)?.points }))
      .toSorted((left, right) => (left.points?.at(-1)?.x ?? 0) - (right.points?.at(-1)?.x ?? 0));
    for (const { edge, points } of branches) {
      if (!points) continue;
      let cut = -1;
      for (let index = 1; index < points.length; index += 1) {
        const point = points.at(index);
        if (point && point.y >= forkPoint.y - 1) {
          cut = index;
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
      // Several controls can fork the same representative edge, so the trunk
      // key includes the control id to stay unique.
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
    attachChip(representative.id, forkPoint, chip);
  }

  return [...edges.map((edge) => byEdgeId.get(edge.id) ?? edge), ...trunks];
}
