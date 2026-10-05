import { componentPathEmphasis, selectEdgePath } from "@/client/widgets/component-structure-path-selection";
import type { DiagramControl, DiagramGraph } from "@/features/diagram/diagram-graph";

const conditional = (id: string): DiagramControl => ({
  id,
  owner: "app",
  kind: "conditional",
  label: id,
  dependsOn: [[]],
});

const graph: DiagramGraph = {
  groups: [],
  nodes: [
    { id: "app", type: "default", title: "App" },
    { id: "leaf", type: "default", title: "Leaf" },
  ],
  edges: [
    {
      id: "guarded",
      type: "default",
      source: "app",
      target: "leaf",
      activeWhen: [
        [
          { controlId: "a", value: "on" },
          { controlId: "b", value: "on" },
        ],
        [
          { controlId: "a", value: "on" },
          { controlId: "c", value: "on" },
        ],
      ],
      guards: [
        [
          { controlId: "a", value: "on" },
          { controlId: "b", value: "on" },
        ],
        [
          { controlId: "a", value: "on" },
          { controlId: "c", value: "on" },
        ],
      ],
    },
  ],
  roots: ["app"],
  controls: [conditional("a"), conditional("b"), conditional("c")],
};

describe("selectEdgePath", () => {
  it("satisfies a whole AND clause so one click activates the edge", () => {
    const selection = selectEdgePath(graph, { a: "off", b: "off", c: "off" }, "guarded", "b", "on");

    expect(selection).toEqual({ a: "on", b: "on", c: "off" });
    expect(componentPathEmphasis(graph, selection).edges.has("guarded")).toBe(true);
  });

  it("picks the clause naming the clicked condition", () => {
    const selection = selectEdgePath(graph, { a: "off", b: "on", c: "off" }, "guarded", "c", "on");

    expect(selection).toEqual({ a: "on", b: "on", c: "on" });
  });

  it("falls back to a single control selection when the edge has no guards", () => {
    const bare: DiagramGraph = {
      ...graph,
      edges: [{ id: "bare", type: "default", source: "app", target: "leaf" }],
    };

    const selection = selectEdgePath(bare, { a: "off" }, "bare", "a", "on");

    expect(selection).toEqual({ a: "on" });
  });
});
