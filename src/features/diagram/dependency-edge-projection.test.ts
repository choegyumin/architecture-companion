import { projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";

const graph = {
  groups: [
    { groupId: "app", title: "App" },
    { groupId: "pages", title: "Pages", parentGroupId: "app" },
    { groupId: "api", title: "API" },
    { groupId: "shared", title: "Shared" },
  ],
  nodes: [
    { nodeId: "app-a", type: "default", title: "App A", groupId: "app" },
    { nodeId: "app-b", type: "default", title: "App B", groupId: "app" },
    { nodeId: "page", type: "default", title: "Page", groupId: "pages" },
    { nodeId: "api-file", type: "default", title: "API File", groupId: "api" },
    { nodeId: "shared-file", type: "default", title: "Shared File", groupId: "shared" },
    { nodeId: "root", type: "default", title: "Root" },
  ],
  edges: [
    { edgeId: "app-a-to-api", type: "default", sourceNodeId: "app-a", targetNodeId: "api-file" },
    { edgeId: "app-b-to-api", type: "default", sourceNodeId: "app-b", targetNodeId: "api-file" },
    { edgeId: "api-to-app", type: "default", sourceNodeId: "api-file", targetNodeId: "app-a" },
    { edgeId: "page-to-api", type: "default", sourceNodeId: "page", targetNodeId: "api-file" },
    { edgeId: "page-to-shared", type: "default", sourceNodeId: "page", targetNodeId: "shared-file" },
    { edgeId: "app-to-page", type: "default", sourceNodeId: "app-a", targetNodeId: "page" },
    { edgeId: "app-to-app", type: "default", sourceNodeId: "app-a", targetNodeId: "app-b" },
    { edgeId: "api-to-root", type: "default", sourceNodeId: "api-file", targetNodeId: "root" },
    { edgeId: "root-to-api", type: "default", sourceNodeId: "root", targetNodeId: "api-file" },
    { edgeId: "app-self", type: "default", sourceNodeId: "app-a", targetNodeId: "app-a" },
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
  it("aggregates root relationships and mixed-group internals without exposing bundle detail", () => {
    expect(members()).toEqual([
      {
        sourceId: "app",
        targetId: "api",
        edgeIds: ["app-a-to-api", "app-b-to-api", "page-to-api"],
      },
      { sourceId: "api", targetId: "app", edgeIds: ["api-to-app"] },
      { sourceId: "app", targetId: "shared", edgeIds: ["page-to-shared"] },
      { sourceId: "bundle:app", targetId: "pages", edgeIds: ["app-to-page"] },
      { sourceId: "api", targetId: "root", edgeIds: ["api-to-root"] },
      { sourceId: "root", targetId: "api", edgeIds: ["root-to-api"] },
    ]);
  });

  it("shows each relationship once at its lowest common scope at every depth", () => {
    const nested = {
      groups: [
        { groupId: "A", title: "A" },
        { groupId: "B", title: "B", parentGroupId: "A" },
        { groupId: "C", title: "C", parentGroupId: "B" },
        { groupId: "D", title: "D", parentGroupId: "C" },
        { groupId: "E", title: "E" },
        { groupId: "F", title: "F", parentGroupId: "E" },
        { groupId: "G", title: "G", parentGroupId: "F" },
        { groupId: "H", title: "H", parentGroupId: "G" },
        { groupId: "X", title: "X", parentGroupId: "B" },
        { groupId: "Y", title: "Y", parentGroupId: "C" },
      ],
      nodes: [
        { nodeId: "d", type: "default", title: "D file", groupId: "D" },
        { nodeId: "d2", type: "default", title: "Other D file", groupId: "D" },
        { nodeId: "h", type: "default", title: "H file", groupId: "H" },
        { nodeId: "x", type: "default", title: "X file", groupId: "X" },
        { nodeId: "y", type: "default", title: "Y file", groupId: "Y" },
        { nodeId: "c", type: "default", title: "C file", groupId: "C" },
        { nodeId: "c2", type: "default", title: "Other C file", groupId: "C" },
        { nodeId: "root", type: "default", title: "Root" },
        { nodeId: "other-root", type: "default", title: "Other root" },
      ],
      edges: [
        { edgeId: "across-roots", type: "default", sourceNodeId: "d", targetNodeId: "h" },
        { edgeId: "inside-B", type: "default", sourceNodeId: "d", targetNodeId: "x" },
        { edgeId: "inside-C", type: "default", sourceNodeId: "d", targetNodeId: "y" },
        { edgeId: "loose-to-child", type: "default", sourceNodeId: "c", targetNodeId: "d" },
        { edgeId: "child-to-loose", type: "default", sourceNodeId: "d", targetNodeId: "c2" },
        { edgeId: "inside-bundle", type: "default", sourceNodeId: "c", targetNodeId: "c2" },
        { edgeId: "inside-leaf", type: "default", sourceNodeId: "d", targetNodeId: "d2" },
        { edgeId: "root-to-group", type: "default", sourceNodeId: "root", targetNodeId: "d" },
        { edgeId: "root-to-root", type: "default", sourceNodeId: "root", targetNodeId: "other-root" },
      ],
    } satisfies DiagramGraph;
    const projected = projectDependencyEdges(nested);
    expect(
      projected.map((edge) => {
        if (edge.type !== "aggregate") throw new Error("Expected overview aggregate");
        return { sourceId: edge.sourceId, targetId: edge.targetId, edgeIds: edge.edgeIds };
      }),
    ).toEqual([
      { sourceId: "A", targetId: "E", edgeIds: ["across-roots"] },
      { sourceId: "C", targetId: "X", edgeIds: ["inside-B"] },
      { sourceId: "D", targetId: "Y", edgeIds: ["inside-C"] },
      { sourceId: "bundle:C", targetId: "D", edgeIds: ["loose-to-child"] },
      { sourceId: "D", targetId: "bundle:C", edgeIds: ["child-to-loose"] },
      { sourceId: "root", targetId: "A", edgeIds: ["root-to-group"] },
      { sourceId: "root", targetId: "other-root", edgeIds: ["root-to-root"] },
    ]);
    expect(
      projectDependencyEdges({ ...nested, groups: [...nested.groups].reverse(), nodes: [...nested.nodes].reverse() }),
    ).toEqual(projected);
  });

  it("reads each group's parent once when nodes share ancestor paths", () => {
    const parentReads = new Map<string, number>();
    const shared = {
      ...graph,
      groups: graph.groups.map((group) => ({
        ...group,
        get parentGroupId() {
          parentReads.set(group.groupId, (parentReads.get(group.groupId) ?? 0) + 1);
          return "parentGroupId" in group ? group.parentGroupId : undefined;
        },
      })),
    } satisfies DiagramGraph;

    expect(projectDependencyEdges(shared)).toEqual(projectDependencyEdges(graph));
    for (const group of graph.groups) expect(parentReads.get(group.groupId)).toBe(1);
    expect(projectDependencyEdges(shared)).toEqual(projectDependencyEdges(graph));
    for (const group of graph.groups) expect(parentReads.get(group.groupId)).toBe(2);
  });

  it("shows every relationship as original edges when the graph has no groups", () => {
    const plain = {
      groups: [],
      nodes: [
        { nodeId: "a", type: "default", title: "A" },
        { nodeId: "b", type: "default", title: "B" },
      ],
      edges: [
        { edgeId: "a-to-b", type: "default", sourceNodeId: "a", targetNodeId: "b" },
        { edgeId: "b-to-a", type: "default", sourceNodeId: "b", targetNodeId: "a" },
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
      edges: [
        ...graph.edges,
        { edgeId: "page-to-app-b", type: "default", sourceNodeId: "page", targetNodeId: "app-b" },
      ],
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
      edges: [
        ...graph.edges,
        {
          edgeId: 'aggregate:["app","api"]',
          type: "default",
          sourceNodeId: "app-a",
          targetNodeId: "api-file",
        },
      ],
    } as const satisfies DiagramGraph;
    for (const focus of [undefined, { type: "group", id: "app" }] as const) {
      const projected = projectDependencyEdges(colliding, focus);
      const aggregate = projected.find(
        (edge) => edge.type === "aggregate" && edge.sourceId === "app" && edge.targetId === "api",
      );
      expect(aggregate).toEqual({
        type: "aggregate",
        id: 'aggregate:["app","api"]:',
        sourceId: "app",
        targetId: "api",
        edgeIds: ["app-a-to-api", "app-b-to-api", "page-to-api", 'aggregate:["app","api"]'],
      });
    }
    expect(() => projectDependencyEdges(graph, { type: "aggregate", edgeIds: ["unknown"] })).toThrow(
      "Missing focused aggregate edge: unknown",
    );
  });
});
