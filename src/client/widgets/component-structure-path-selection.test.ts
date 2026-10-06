import {
  componentPathEmphasis,
  selectComponentPath,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import type { DiagramControl, DiagramGraph } from "@/features/diagram/diagram-graph";

const conditional = (id: string): DiagramControl => ({
  id,
  owner: "app",
  kind: "conditional",
  label: id,
  dependsOn: [[]],
});

const polarityBranch = (id: string, onLabel: string): DiagramControl => ({
  id,
  owner: "app",
  kind: "branch",
  label: onLabel,
  cases: [
    { id: `${id}:on`, label: onLabel },
    { id: `${id}:off`, label: `!(${onLabel})` },
  ],
  polarityPair: true,
  dependsOn: [[]],
});

// An if / else-if chain: the error decision sits behind the loading branch's
// negated arm, so both switches can never hold their on case at once.
const exclusiveGraph: DiagramGraph = {
  groups: [],
  nodes: [
    { id: "app", type: "default", title: "App" },
    { id: "loading", type: "default", title: "Loading" },
    { id: "loading-view", type: "default", title: "Loading view" },
    { id: "error", type: "default", title: "Error" },
    { id: "error-view", type: "default", title: "Error view" },
    { id: "ready-view", type: "default", title: "Ready view" },
  ],
  edges: [
    { id: "to-loading", type: "default", source: "app", target: "loading" },
    {
      id: "loading-arm",
      type: "default",
      source: "loading",
      target: "loading-view",
      sourcePort: "loading:on",
      activeWhen: [[{ controlId: "loading", value: "loading:on" }]],
    },
    {
      id: "loading-else",
      type: "default",
      source: "loading",
      target: "error",
      sourcePort: "loading:off",
      activeWhen: [[{ controlId: "loading", value: "loading:off" }]],
    },
    {
      id: "error-arm",
      type: "default",
      source: "error",
      target: "error-view",
      sourcePort: "error:on",
      activeWhen: [[{ controlId: "error", value: "error:on" }]],
    },
    {
      id: "error-else",
      type: "default",
      source: "error",
      target: "ready-view",
      sourcePort: "error:off",
      activeWhen: [[{ controlId: "error", value: "error:off" }]],
    },
  ],
  roots: ["app"],
  controls: [polarityBranch("loading", "loading"), polarityBranch("error", "error")],
};

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

describe("selectComponentPath", () => {
  it("settles the other exclusive switch when the click kills its route", () => {
    const selection = selectComponentPath(
      exclusiveGraph,
      { loading: "loading:off", error: "error:on" },
      "loading",
      "loading:on",
    );

    expect(selection).toEqual({ loading: "loading:on", error: "error:off" });
  });

  it("does not settle branches the generator did not mark as polarity pairs", () => {
    const unmarked: DiagramGraph = {
      ...exclusiveGraph,
      controls: exclusiveGraph.controls!.map((control) => ({ ...control, polarityPair: undefined })),
    };

    const selection = selectComponentPath(
      unmarked,
      { loading: "loading:off", error: "error:on" },
      "loading",
      "loading:on",
    );

    expect(selection).toEqual({ loading: "loading:on", error: "error:on" });
  });

  it("reroutes through the negated arm when the on case needs it", () => {
    const selection = selectComponentPath(
      exclusiveGraph,
      { loading: "loading:on", error: "error:off" },
      "error",
      "error:on",
    );

    expect(selection).toEqual({ loading: "loading:off", error: "error:on" });
  });

  it("keeps the clicked value when no route can carry it", () => {
    const unreachable: DiagramGraph = {
      ...exclusiveGraph,
      edges: exclusiveGraph.edges.filter((edge) => edge.id !== "loading-else"),
    };

    const selection = selectComponentPath(
      unreachable,
      { loading: "loading:on", error: "error:off" },
      "error",
      "error:on",
    );

    expect(selection).toEqual({ loading: "loading:on", error: "error:on" });
  });

  it("keeps conditional values on paths the click turned off", () => {
    const gated: DiagramGraph = {
      ...exclusiveGraph,
      nodes: [...exclusiveGraph.nodes, { id: "detail", type: "default", title: "Detail" }],
      edges: [
        ...exclusiveGraph.edges,
        {
          id: "detail",
          type: "default",
          source: "loading-view",
          target: "detail",
          activeWhen: [[{ controlId: "child", value: "on" }]],
          guards: [[{ controlId: "child", value: "on" }]],
        },
      ],
      controls: [...(exclusiveGraph.controls ?? []), { ...conditional("child"), owner: "loading-view" }],
    };

    const selection = selectComponentPath(
      gated,
      { loading: "loading:off", error: "error:off", child: "on" },
      "loading",
      "loading:on",
    );

    expect(selection).toEqual({ loading: "loading:on", error: "error:off", child: "on" });
  });
});

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

  it("restores a partially held clause from a pressed pill", () => {
    const selection = selectEdgePath(graph, { a: "on", b: "off", c: "off" }, "guarded", "a", "on");

    expect(selection).toEqual({ a: "on", b: "on", c: "off" });
  });

  it("keeps conditions another satisfied clause still uses when turning a clause off", () => {
    const selection = selectEdgePath(graph, { a: "on", b: "on", c: "on" }, "guarded", "b", "on");

    expect(selection).toEqual({ a: "on", b: "off", c: "on" });
  });

  it("turns every condition off when no other clause shares them", () => {
    const selection = selectEdgePath(graph, { a: "on", b: "on", c: "off" }, "guarded", "b", "on");

    expect(selection).toEqual({ a: "off", b: "off", c: "off" });
  });

  it("forces a lone shared condition off when nothing can be spared", () => {
    const sharedGraph: DiagramGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "spare",
          type: "default",
          source: "app",
          target: "leaf",
          activeWhen: [[{ controlId: "a", value: "on" }]],
          guards: [[{ controlId: "a", value: "on" }]],
        },
      ],
    };

    const selection = selectEdgePath(sharedGraph, { a: "on", b: "on", c: "on" }, "spare", "a", "on");

    expect(selection).toEqual({ a: "off", b: "on", c: "on" });
  });
});
