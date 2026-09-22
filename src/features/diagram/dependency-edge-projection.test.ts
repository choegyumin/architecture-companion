import { projectDiagramDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";

const graph = {
  groups: [
    { id: "group-a", title: "A" },
    { id: "group-a-child", title: "A child", parentId: "group-a" },
    { id: "group-b", title: "B" },
  ],
  nodes: [
    { id: "a-direct", type: "default", title: "A direct", groupId: "group-a" },
    { id: "a-child", type: "default", title: "A child", groupId: "group-a-child" },
    { id: "b", type: "default", title: "B", groupId: "group-b" },
    { id: "loose", type: "default", title: "Loose" },
  ],
  edges: [
    { id: "a-internal", type: "default", source: "a-direct", target: "a-child" },
    { id: "a-child-to-b", type: "default", source: "a-child", target: "b" },
    { id: "a-direct-to-b", type: "default", source: "a-direct", target: "b" },
    { id: "b-to-a-child", type: "default", source: "b", target: "a-child" },
    { id: "loose-to-b", type: "default", source: "loose", target: "b" },
  ],
} satisfies DiagramGraph;

describe("dependency edge projection", () => {
  it("aggregates dependencies between top-level modules", () => {
    expect(projectDiagramDependencyEdges(graph)).toEqual([
      {
        type: "aggregate",
        id: "aggregate:group-a->group-b",
        source: "group-a",
        target: "group-b",
        count: 2,
        edgeIds: ["a-child-to-b", "a-direct-to-b"],
      },
      {
        type: "aggregate",
        id: "aggregate:group-b->group-a",
        source: "group-b",
        target: "group-a",
        count: 1,
        edgeIds: ["b-to-a-child"],
      },
      {
        type: "aggregate",
        id: "aggregate:loose->group-b",
        source: "loose",
        target: "group-b",
        count: 1,
        edgeIds: ["loose-to-b"],
      },
    ]);
  });

  it("shows original internal edges and aggregated boundary edges for a group", () => {
    expect(projectDiagramDependencyEdges(graph, { type: "group", id: "group-a" })).toEqual([
      { type: "original", edgeId: "a-internal" },
      {
        type: "aggregate",
        id: "aggregate:group-a->group-b",
        source: "group-a",
        target: "group-b",
        count: 2,
        edgeIds: ["a-child-to-b", "a-direct-to-b"],
      },
      {
        type: "aggregate",
        id: "aggregate:group-b->group-a",
        source: "group-b",
        target: "group-a",
        count: 1,
        edgeIds: ["b-to-a-child"],
      },
    ]);
  });

  it("shows every original edge incident to a focused node", () => {
    expect(projectDiagramDependencyEdges(graph, { type: "node", id: "a-child" })).toEqual([
      { type: "original", edgeId: "a-internal" },
      { type: "original", edgeId: "a-child-to-b" },
      { type: "original", edgeId: "b-to-a-child" },
    ]);
  });

  it("shows the original edges represented by a focused aggregate", () => {
    expect(
      projectDiagramDependencyEdges(graph, {
        type: "aggregate",
        edgeIds: ["a-child-to-b", "a-direct-to-b"],
      }),
    ).toEqual([
      { type: "original", edgeId: "a-child-to-b" },
      { type: "original", edgeId: "a-direct-to-b" },
    ]);
  });
});
