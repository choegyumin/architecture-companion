import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type { ComponentStructureDiagramGraph } from "@/features/diagram/diagram-graph";

// A gate whose disjuncts all traverse the same branch: one disjunct is the
// branch choice alone, another carries a conditional before it. This is the
// shape `(a || b) ? (a ? <p/> : null) : null` projects to before the hop split.
const graph: ComponentStructureDiagramGraph = {
  groups: [],
  nodes: [
    { id: "root", type: "default", title: "Root" },
    { id: "leaf", type: "default", title: "Leaf" },
  ],
  edges: [
    {
      id: "route",
      type: "control",
      source: "root",
      target: "leaf",
      activeWhen: [
        [{ controlId: "a", value: "a1" }],
        [
          { controlId: "b", value: "on" },
          { controlId: "a", value: "a1" },
        ],
      ],
    },
  ],
  additional: {
    roots: ["root"],
    controls: [
      {
        id: "a",
        owner: "root",
        kind: "branch",
        label: "a",
        dependsOn: [[]],
        cases: [
          { id: "a1", label: "A1" },
          { id: "a2", label: "A2" },
        ],
      },
      { id: "b", owner: "root", kind: "conditional", label: "b", dependsOn: [[]] },
    ],
  },
};

const projected = projectDecisionNodes(graph);
const entry = projected.edges.find((edge) => edge.source === "root" && edge.target === "a");
const arm = projected.edges.find((edge) => edge.source === "a" && edge.target === "leaf");

describe("projectDecisionNodes", () => {
  it("folds the entry hop's guard rules instead of dangling an empty alternative", () => {
    // The branch choice moved into the arm's port and the conditional rides
    // the arm, so the entry hop's rules collapse to the always-true form —
    // never `[] || b on`, which reads as if b alone activates the route.
    expect(entry?.guards).toEqual([[]]);
  });

  it("keeps the branch choice as the arm's port and guard", () => {
    expect(arm?.sourcePort).toBe("a1");
    expect(arm?.guards).toEqual([[{ controlId: "a", value: "a1" }]]);
  });

  it("projects the branch control as a decision node and dead cases as non-component nodes", () => {
    expect(projected.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "decision", id: "a", title: "a" }),
        expect.objectContaining({ type: "non-component", id: "a:a2:non-component", caseId: "a2" }),
      ]),
    );
  });

  it("routes a dead case from its decision node through its own port", () => {
    const dead = projected.edges.find((edge) => edge.target === "a:a2:non-component");
    expect(dead).toMatchObject({ source: "a", sourcePort: "a2" });
    expect(dead?.guards).toEqual([[{ controlId: "a", value: "a2" }]]);
  });
});
