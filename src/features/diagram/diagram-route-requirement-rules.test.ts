import type { DiagramRouteRequirementRuleset } from "@/features/diagram/diagram-graph";
import { combineRulesets, unionRulesets } from "@/features/diagram/diagram-route-requirement-rules";

const on = (controlId: string): DiagramRouteRequirementRuleset => [[{ controlId, value: "on" }]];

describe("unionRulesets", () => {
  it("drops duplicate rules", () => {
    expect(unionRulesets(on("a"), on("a"), on("b"))).toEqual([...on("a"), ...on("b")]);
  });

  it("keeps an empty call empty rather than inventing a tautology", () => {
    expect(unionRulesets()).toEqual([]);
  });

  it("folds a ruleset holding the empty rule to the always-true form", () => {
    // The empty rule is the empty conjunction — true — so it dominates the
    // disjunction instead of rendering as a dangling `||` alternative.
    expect(unionRulesets([[]], on("a"))).toEqual([[]]);
    expect(unionRulesets(on("a"), [[]])).toEqual([[]]);
    expect(unionRulesets([[]])).toEqual([[]]);
  });
});

describe("combineRulesets", () => {
  it("crosses prefixes with suffixes and drops contradictions", () => {
    expect(combineRulesets(on("a"), [[{ controlId: "b", value: "on" }], [{ controlId: "a", value: "off" }]])).toEqual([
      [
        { controlId: "a", value: "on" },
        { controlId: "b", value: "on" },
      ],
    ]);
  });

  it("lets the always-true ruleset pass the other side through", () => {
    expect(combineRulesets([[]], on("a"))).toEqual(on("a"));
    expect(combineRulesets(on("a"), [[]])).toEqual(on("a"));
  });
});
