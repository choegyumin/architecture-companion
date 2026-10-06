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

// A branch whose two cases are exactly an expression and its negation
// behaves, from the owner's seat, like one on/off gate: the first case is on
// and its complement is off. The data stays a branch (its arms still split
// by case) — only the owning card's field renders a switch for it.
function unwrapPolarity(label: string): { text: string; negated: boolean } {
  let text = label.trim();
  let negated = false;
  for (;;) {
    if (text.startsWith("!(") && text.endsWith(")")) {
      text = text.slice(2, -1).trim();
      negated = !negated;
      continue;
    }
    if (text.startsWith("!") && !text.startsWith("!=")) {
      text = text.slice(1).trim();
      negated = !negated;
      continue;
    }
    break;
  }
  return { text, negated };
}

export function isPolarityPairBranch(control: DiagramControl): boolean {
  if (control.kind !== "branch" || control.cases.length !== 2) return false;
  const first = unwrapPolarity(control.cases.at(0)?.label ?? "");
  const second = unwrapPolarity(control.cases.at(1)?.label ?? "");
  return first.text.length > 0 && first.text === second.text && first.negated !== second.negated;
}

export function polarityPairLabel(control: DiagramControl): string {
  if (control.kind !== "branch") return control.label;
  return unwrapPolarity(control.cases.at(0)?.label ?? control.label).text;
}

export type RouteConditionChange = Readonly<{
  controlId: string;
  kind: DiagramControl["kind"];
  label: string;
  before: string;
  after: string;
}>;

const requirementValueLabel = (control: DiagramControl, value: string): string => {
  if (control.kind !== "branch") return value;
  return control.cases.find((branchCase) => branchCase.id === value)?.label ?? value;
};

// The before/after diff hovering an edge or node asks for: applying that
// route's rule (the same engine a label click runs) against the current
// selection, then reporting only the controls whose value would move.
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
  return graph
    .controls!.filter((control) => next[control.id] !== selection[control.id])
    .map((control) => ({
      controlId: control.id,
      kind: control.kind,
      label: control.label,
      before: requirementValueLabel(control, selection[control.id] ?? ""),
      after: requirementValueLabel(control, next[control.id] ?? ""),
    }));
}

// Nodes hover by their decisive incoming edge: the active one when a path
// already reaches the node, otherwise the first incoming edge in graph order.
export function representativeIncomingEdgeId(
  graph: DiagramGraph,
  activeEdges: ReadonlySet<string>,
  nodeId: string,
): string | undefined {
  const incoming = graph.edges.filter((edge) => edge.target === nodeId && edge.type === "default");
  return incoming.find((edge) => activeEdges.has(edge.id))?.id ?? incoming.at(0)?.id;
}
