import type { DiagramRouteRequirementRule, DiagramRouteRequirementRuleset } from "@/features/diagram/diagram-graph";

/** Unions rulesets into one, dropping duplicate rules. */
export function unionRulesets(...sets: DiagramRouteRequirementRuleset[]): DiagramRouteRequirementRuleset {
  const rules = new Map<string, DiagramRouteRequirementRule>();
  for (const rule of sets.flat()) rules.set(JSON.stringify(rule), rule);
  return [...rules.values()];
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
