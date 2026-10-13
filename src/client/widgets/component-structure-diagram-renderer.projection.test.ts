import { componentStructureDiagramGraphSchema } from "@/features/diagram/diagram-graph";

import { projectDecisionNodes } from "./component-structure-diagram-renderer";

// A gate whose disjuncts all traverse the same branch: one disjunct is the
// branch choice alone, another carries a conditional before it. This is the
// shape `(a || b) ? (a ? <p/> : null) : null` projects to before the hop split.
const graph = componentStructureDiagramGraphSchema.parse({
  groups: [],
  nodes: [
    { nodeId: "root", type: "default", title: "Root" },
    { nodeId: "leaf", type: "default", title: "Leaf" },
  ],
  edges: [
    {
      edgeId: "route",
      type: "control",
      sourceNodeId: "root",
      targetNodeId: "leaf",
      activeWhen: [
        [{ controlId: "a", value: "a1" }],
        [
          { controlId: "b", value: "on" },
          { controlId: "a", value: "a1" },
        ],
      ],
    },
  ],
  layoutContext: {
    rootNodeIds: ["root"],
    controls: [
      {
        controlId: "a",
        ownerNodeId: "root",
        type: "branch",
        label: "a",
        dependsOn: [[]],
        cases: [
          { caseId: "a1", label: "A1" },
          { caseId: "a2", label: "A2" },
        ],
      },
      { controlId: "b", ownerNodeId: "root", type: "conditional", label: "b", dependsOn: [[]] },
    ],
  },
});

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

  it("carries the originating stored edge id on every hop it was cut into", () => {
    expect(entry?.originEdgeIds).toEqual(["route"]);
    expect(arm?.originEdgeIds).toEqual(["route"]);
  });

  it("marks a dead case as rendering nothing stored", () => {
    const dead = projected.edges.find((edge) => edge.target === "a:a2:non-component");
    expect(dead?.originEdgeIds).toEqual([]);
  });
});

// Whole edges, collapsed segments, and their provenance union: two stored
// edges whose rules cut into the same hops, plus one unconditioned edge that
// stays whole.
const provenanceGraph = componentStructureDiagramGraphSchema.parse({
  groups: [],
  nodes: [
    { nodeId: "root", type: "default", title: "Root" },
    { nodeId: "leaf", type: "default", title: "Leaf" },
  ],
  edges: [
    {
      edgeId: "one",
      type: "control",
      sourceNodeId: "root",
      targetNodeId: "leaf",
      activeWhen: [[{ controlId: "a", value: "a1" }]],
    },
    {
      edgeId: "two",
      type: "control",
      sourceNodeId: "root",
      targetNodeId: "leaf",
      activeWhen: [
        [
          { controlId: "b", value: "on" },
          { controlId: "a", value: "a1" },
        ],
      ],
    },
    { edgeId: "plain", sourceNodeId: "root", targetNodeId: "leaf" },
  ],
  layoutContext: {
    rootNodeIds: ["root"],
    controls: [
      {
        controlId: "a",
        ownerNodeId: "root",
        type: "branch",
        label: "a",
        dependsOn: [[]],
        cases: [
          { caseId: "a1", label: "A1" },
          { caseId: "a2", label: "A2" },
        ],
      },
      { controlId: "b", ownerNodeId: "root", type: "conditional", label: "b", dependsOn: [[]] },
    ],
  },
});

describe("projectDecisionNodes stored-edge provenance", () => {
  const provenanceProjected = projectDecisionNodes(provenanceGraph);

  it("unions the stored edge ids that collapse into one segment", () => {
    const segment = provenanceProjected.edges.find((edge) => edge.source === "root" && edge.target === "a");
    expect(segment?.originEdgeIds).toEqual(["one", "two"]);
  });

  it("keeps a whole edge's origin to its own stored id", () => {
    const whole = provenanceProjected.edges.find(
      (edge) => edge.source === "root" && edge.target === "leaf" && edge.sourcePort == null,
    );
    expect(whole?.originEdgeIds).toEqual(["plain"]);
  });
});
