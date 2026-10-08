import type { DiagramRouteRequirementRule, DiagramRouteRequirementRuleset } from "@/features/diagram/diagram-graph";

/**
 * Unions rulesets into one, dropping duplicate rules. An empty rule is the
 * empty conjunction — a tautology that dominates the disjunction — so a
 * ruleset containing one collapses to the always-true form `[[]]`.
 */
export function unionRulesets(...sets: DiagramRouteRequirementRuleset[]): DiagramRouteRequirementRuleset {
  const rules = new Map<string, DiagramRouteRequirementRule>();
  let tautology = false;
  for (const rule of sets.flat()) {
    if (rule.length === 0) tautology = true;
    rules.set(JSON.stringify(rule), rule);
  }
  return tautology ? [[]] : [...rules.values()];
}

/** Crosses two rulesets: every surviving rule requires a prefix and a suffix. */
export function combineRulesets(
  left: DiagramRouteRequirementRuleset,
  right: DiagramRouteRequirementRuleset,
): DiagramRouteRequirementRuleset {
  return unionRulesets(
    left.flatMap((prefix) =>
      right.flatMap((suffix) => {
        const rule = [...prefix];
        for (const requirement of suffix) {
          const existing = rule.find(({ controlId }) => controlId === requirement.controlId);
          if (existing && existing.value !== requirement.value) return [];
          if (!existing) rule.push(requirement);
        }
        return [rule];
      }),
    ),
  );
}
