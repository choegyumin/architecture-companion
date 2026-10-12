import { calculateConditionPolarityPair } from "@/features/diagram/control-polarity";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";

import { componentPathEmphasis, selectComponentPath } from "./component-structure-path-selection";

const graph = projectDecisionNodes({
  groups: [],
  nodes: [
    { nodeId: "root", type: "default", title: "Root" },
    { nodeId: "leaf", type: "default", title: "Leaf" },
  ],
  edges: [
    {
      edgeId: "render",
      type: "control",
      sourceNodeId: "root",
      targetNodeId: "leaf",
      activeWhen: [
        [
          { controlId: "outer", value: "true" },
          { controlId: "inner", value: "false" },
        ],
      ],
    },
  ],
  layoutContext: {
    rootNodeIds: ["root"],
    controls: [
      {
        controlId: "outer",
        ownerNodeId: "root",
        type: "branch",
        dependsOn: [[]],
        ...calculateConditionPolarityPair("outer"),
      },
      {
        controlId: "inner",
        ownerNodeId: "root",
        type: "branch",
        dependsOn: [[{ controlId: "outer", value: "true" }]],
        ...calculateConditionPolarityPair("!inner"),
      },
    ],
  },
});

describe("polarity-pair path selection", () => {
  it("settles a newly unreachable switch to its OFF case even when that case is named true", () => {
    const before = { outer: "true", inner: "false" };
    expect(componentPathEmphasis(graph, before).nodes.has("inner")).toBe(true);
    const after = selectComponentPath(graph, before, "outer", "false");
    expect(after).toEqual({ outer: "false", inner: "true" });
    expect(componentPathEmphasis(graph, after).nodes.has("inner")).toBe(false);
    expect(componentPathEmphasis(graph, after).nodes.has("leaf")).toBe(false);
  });

  it("preserves intent on an already unreachable pair and restores prerequisites when it is selected", () => {
    const before = { outer: "false", inner: "false" };
    expect(selectComponentPath(graph, before, "outer", "false")).toEqual(before);
    const after = selectComponentPath(graph, before, "inner", "false");
    expect(after).toEqual({ outer: "true", inner: "false" });
    expect(componentPathEmphasis(graph, after).nodes.has("leaf")).toBe(true);
  });
});
