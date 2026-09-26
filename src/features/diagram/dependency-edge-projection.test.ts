import { projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";

const graph = {
  groups: [
    { id: "app", title: "App" },
    { id: "pages", title: "Pages", parentId: "app" },
    { id: "api", title: "API" },
    { id: "shared", title: "Shared" },
  ],
  nodes: [
    { id: "app-a", type: "default", title: "App A", groupId: "app" },
    { id: "app-b", type: "default", title: "App B", groupId: "app" },
    { id: "page", type: "default", title: "Page", groupId: "pages" },
    { id: "api-file", type: "default", title: "API File", groupId: "api" },
    { id: "shared-file", type: "default", title: "Shared File", groupId: "shared" },
    { id: "root", type: "default", title: "Root" },
  ],
  edges: [
    { id: "app-a-to-api", type: "default", source: "app-a", target: "api-file" },
    { id: "app-b-to-api", type: "default", source: "app-b", target: "api-file" },
    { id: "api-to-app", type: "default", source: "api-file", target: "app-a" },
    { id: "page-to-api", type: "default", source: "page", target: "api-file" },
    { id: "page-to-shared", type: "default", source: "page", target: "shared-file" },
    { id: "app-to-page", type: "default", source: "app-a", target: "page" },
    { id: "app-to-app", type: "default", source: "app-a", target: "app-b" },
    { id: "api-to-root", type: "default", source: "api-file", target: "root" },
    { id: "root-to-api", type: "default", source: "root", target: "api-file" },
    { id: "app-self", type: "default", source: "app-a", target: "app-a" },
  ],
} as const satisfies DiagramGraph;

function members(focus?: Parameters<typeof projectDependencyEdges>[1]) {
  return projectDependencyEdges(graph, focus).map((edge) =>
    edge.type === "aggregate"
      ? { sourceId: edge.sourceId, targetId: edge.targetId, edgeIds: edge.edgeIds }
      : { edgeId: edge.edgeId },
  );
}

describe("dependency edge projection", () => {
  it("aggregates top-level relationships by ordered endpoints and excludes internal edges", () => {
    expect(members()).toEqual([
      {
        sourceId: "app",
        targetId: "api",
        edgeIds: ["app-a-to-api", "app-b-to-api", "page-to-api"],
      },
      { sourceId: "api", targetId: "app", edgeIds: ["api-to-app"] },
      { sourceId: "app", targetId: "shared", edgeIds: ["page-to-shared"] },
      { sourceId: "api", targetId: "root", edgeIds: ["api-to-root"] },
      { sourceId: "root", targetId: "api", edgeIds: ["root-to-api"] },
    ]);
  });

  it("shows every relationship as original edges when the graph has no groups", () => {
    const plain = {
      groups: [],
      nodes: [
        { id: "a", type: "default", title: "A" },
        { id: "b", type: "default", title: "B" },
      ],
      edges: [
        { id: "a-to-b", type: "default", source: "a", target: "b" },
        { id: "b-to-a", type: "default", source: "b", target: "a" },
      ],
    } as const satisfies DiagramGraph;

    expect(projectDependencyEdges(plain)).toEqual([
      { type: "original", edgeId: "a-to-b" },
      { type: "original", edgeId: "b-to-a" },
    ]);
  });

  it("shows only internal original edges and directional boundary aggregates for a group", () => {
    expect(members({ type: "group", id: "app" })).toEqual([
      { edgeId: "app-to-page" },
      { edgeId: "app-to-app" },
      { edgeId: "app-self" },
      {
        sourceId: "app",
        targetId: "api",
        edgeIds: ["app-a-to-api", "app-b-to-api", "page-to-api"],
      },
      { sourceId: "api", targetId: "app", edgeIds: ["api-to-app"] },
      { sourceId: "app", targetId: "shared", edgeIds: ["page-to-shared"] },
    ]);
    expect(members({ type: "group", id: "pages" })).toEqual([
      { sourceId: "pages", targetId: "api", edgeIds: ["page-to-api"] },
      { sourceId: "pages", targetId: "shared", edgeIds: ["page-to-shared"] },
      { sourceId: "app-a", targetId: "pages", edgeIds: ["app-to-page"] },
    ]);
  });

  it("keeps direct sibling nodes as boundary endpoints in either direction", () => {
    const withSibling = {
      ...graph,
      edges: [...graph.edges, { id: "page-to-app-b", type: "default", source: "page", target: "app-b" }],
    } as const satisfies DiagramGraph;
    const projections = projectDependencyEdges(withSibling, { type: "group", id: "pages" });

    expect(
      projections.flatMap((edge) =>
        edge.type === "aggregate" && (edge.sourceId === "app-a" || edge.targetId === "app-b")
          ? [{ sourceId: edge.sourceId, targetId: edge.targetId, edgeIds: edge.edgeIds }]
          : [],
      ),
    ).toEqual([
      { sourceId: "app-a", targetId: "pages", edgeIds: ["app-to-page"] },
      { sourceId: "pages", targetId: "app-b", edgeIds: ["page-to-app-b"] },
    ]);
  });

  it("shows only incident original edges for a node", () => {
    expect(members({ type: "node", id: "app-a" })).toEqual([
      { edgeId: "app-a-to-api" },
      { edgeId: "api-to-app" },
      { edgeId: "app-to-page" },
      { edgeId: "app-to-app" },
      { edgeId: "app-self" },
    ]);
  });

  it("expands exactly the selected aggregate membership", () => {
    const selected = projectDependencyEdges(graph).find(
      (edge) => edge.type === "aggregate" && edge.sourceId === "app" && edge.targetId === "api",
    );
    if (!selected || selected.type !== "aggregate") throw new Error("Missing aggregate");
    expect(members({ type: "aggregate", edgeIds: selected.edgeIds })).toEqual([
      { edgeId: "app-a-to-api" },
      { edgeId: "app-b-to-api" },
      { edgeId: "page-to-api" },
    ]);
  });

  it("keeps aggregate IDs separate from original IDs and rejects unknown focus members", () => {
    const colliding = {
      ...graph,
      edges: [...graph.edges, { id: 'aggregate:["app","api"]', type: "default", source: "app-a", target: "api-file" }],
    } as const satisfies DiagramGraph;
    const projected = projectDependencyEdges(colliding);
    const aggregate = projected.find(
      (edge) => edge.type === "aggregate" && edge.sourceId === "app" && edge.targetId === "api",
    );
    expect(aggregate?.type).toBe("aggregate");
    if (aggregate?.type !== "aggregate") throw new Error("Missing aggregate");
    expect(aggregate.id).not.toBe('aggregate:["app","api"]');
    expect(() => projectDependencyEdges(graph, { type: "aggregate", edgeIds: ["unknown"] })).toThrow(
      "Missing focused aggregate edge: unknown",
    );
  });
});
