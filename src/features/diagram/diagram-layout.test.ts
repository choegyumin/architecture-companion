import { layoutDiagram } from "@/features/diagram/diagram-layout";

const elkDiagram = {
  layout: { id: "elk-layered" },
  graph: {
    groups: [],
    nodes: [
      { id: "source", type: "default", kind: "component", title: "Source" },
      { id: "target", type: "default", kind: "component", title: "Target" },
    ],
    edges: [{ id: "source-target", type: "default", source: "source", target: "target" }],
  },
} satisfies Parameters<typeof layoutDiagram>[0];

const sequenceDiagram = {
  layout: { id: "sequence" },
  graph: {
    groups: [],
    nodes: [
      { id: "client", type: "lifeline", kind: "participant", title: "Client", activations: [] },
      { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
    ],
    edges: [{ id: "request", type: "message", source: "client", target: "server", messageType: "sync" }],
  },
} satisfies Parameters<typeof layoutDiagram>[0];

describe("diagram layout dispatcher", () => {
  test("routes a dependency graph layout to the nested dependency strategy", async () => {
    const result = await layoutDiagram(
      { ...elkDiagram, layout: { id: "dependency-graph" } },
      { source: { width: 160, height: 120 }, target: { width: 160, height: 120 } },
    );

    expect(result.nodes.map(({ id }) => id)).toEqual(["source", "target"]);
    expect(result.edges.map(({ id }) => id)).toEqual(["source-target"]);
    expect(result.initialView).toEqual({ mode: "fit" });
  });

  test("routes an ELK layout configuration to the built-in ELK strategy", async () => {
    const result = await layoutDiagram(elkDiagram, {
      source: { width: 160, height: 120 },
      target: { width: 160, height: 120 },
    });

    expect(result.nodes.map(({ id }) => id)).toEqual(["source", "target"]);
  });

  test("routes a sequence layout configuration to the built-in sequence strategy", async () => {
    const result = await layoutDiagram(sequenceDiagram, {
      client: { width: 160, height: 120 },
      server: { width: 160, height: 120 },
    });

    expect(result.nodes.find(({ id }) => id === "client")?.data).toMatchObject({
      handles: [{ id: "request:source", side: "right" }],
    });
  });
});
