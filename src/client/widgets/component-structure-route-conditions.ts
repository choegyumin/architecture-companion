import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import { selectEdgePath } from "@/client/widgets/component-structure-path-selection";
import type {
  DiagramControl,
  DiagramEdge,
  DiagramGraph,
  DiagramRouteRequirementRule,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";

// The combined condition text one edge needs: each AND rule joins its
// requirements and the ruleset joins the rules with ||, so a label states the
// whole activation condition once instead of scattering pills.
const requirementText = (controls: readonly DiagramControl[], controlId: string, value: string): string => {
  const control = controls.find((item) => item.id === controlId);
  if (!control) return value;
  if (control.kind === "branch") {
    return control.cases.find((branchCase) => branchCase.id === value)?.label ?? value;
  }
  return control.label;
};

const ruleText = (controls: readonly DiagramControl[], rule: DiagramRouteRequirementRule): string =>
  rule.map(({ controlId, value }) => requirementText(controls, controlId, value)).join(" && ");

export function routeConditionText(
  controls: readonly DiagramControl[],
  guards: DiagramRouteRequirementRuleset,
): string {
  const rules = guards.map((rule) => ruleText(controls, rule));
  // A multi-requirement rule keeps its parentheses inside an OR list so the
  // AND grouping stays readable.
  return rules.map((text, index) => (rules.length > 1 && guards[index].length > 1 ? `(${text})` : text)).join(" || ");
}

// An edge label carries the branch icon when any rule names a branch case, so
// splitting controls stay visually distinct from plain conditional gates.
export function routeConditionIncludesBranch(
  controls: readonly DiagramControl[],
  guards: DiagramRouteRequirementRuleset,
): boolean {
  return guards.some((rule) =>
    rule.some(({ controlId }) => controls.find((item) => item.id === controlId)?.kind === "branch"),
  );
}

const INSTANCE_ID_SUFFIX = /@[0-9a-f]{16}$/;
// Merged cards carry the definition id while edges point at instances.
export const toDefinitionId = (nodeId: string): string => nodeId.replace(INSTANCE_ID_SUFFIX, "");

export type RouteConditionChange = Readonly<{
  controlId: string;
  kind: DiagramControl["kind"];
  label: string;
  ownerLabel: string;
  before: string;
  after: string;
}>;

const requirementValueLabel = (control: DiagramControl, value: string): string => {
  if (control.kind !== "branch") return value;
  return control.cases.find((branchCase) => branchCase.id === value)?.label ?? value;
};

// The before/after diff hovering an edge or node asks for: applying that
// route's rule (the same engine a label click runs) against the current
// selection, then reporting only the controls whose value would move. Each
// change names the component that owns the control.
export function describeRouteSelectionChange(
  graph: DiagramGraph,
  selection: ComponentSelection,
  edgeId: string,
): readonly RouteConditionChange[] {
  const edge = graph.edges.find((item): item is DiagramEdge => item.id === edgeId);
  const guards = edge && edge.type === "default" ? edge.guards : undefined;
  const representative = guards?.at(0)?.at(0);
  if (!representative) return [];
  const next = selectEdgePath(graph, selection, edgeId, representative.controlId, representative.value);
  const titleByDefinitionId = new Map(
    graph.nodes.map((node) => [toDefinitionId(node.id), node.title ?? node.id] as const),
  );
  return graph
    .controls!.filter((control) => next[control.id] !== selection[control.id])
    .map((control) => ({
      controlId: control.id,
      kind: control.kind,
      label: control.label,
      ownerLabel: titleByDefinitionId.get(control.owner) ?? control.owner,
      before: requirementValueLabel(control, selection[control.id] ?? ""),
      after: requirementValueLabel(control, next[control.id] ?? ""),
    }));
}
