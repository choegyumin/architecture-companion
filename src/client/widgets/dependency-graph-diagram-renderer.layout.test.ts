import { layoutDependencyGraph } from "@/client/widgets/dependency-graph-diagram-renderer.layout";
import type { DependencyDiagramGraph } from "@/features/diagram/diagram-graph";
import { dependencyDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function sizes(graph: DependencyDiagramGraph): DiagramNodeSizes {
  return Object.fromEntries(graph.nodes.map(({ nodeId }) => [nodeId, { width: 288, height: 144 }]));
}

function absolutePosition(layout: DiagramLayout, id: string): { x: number; y: number } {
  const element = [...layout.nodes, ...layout.groups].find((placement) => placement.id === id);
  if (!element) throw new Error(`Unknown placement: ${id}`);
  if (!element.parentId) return element.position;
  const parent = absolutePosition(layout, element.parentId);
  return { x: parent.x + element.position.x, y: parent.y + element.position.y };
}

function doesNotOverlap(layout: DiagramLayout, leftId: string, rightId: string): boolean {
  const left = [...layout.nodes, ...layout.groups].find(({ id }) => id === leftId);
  const right = [...layout.nodes, ...layout.groups].find(({ id }) => id === rightId);
  if (!left || !right) throw new Error("Missing placement");
  const a = absolutePosition(layout, leftId);
  const b = absolutePosition(layout, rightId);
  return (
    a.x + left.size.width <= b.x ||
    b.x + right.size.width <= a.x ||
    a.y + left.size.height <= b.y ||
    b.y + right.size.height <= a.y
  );
}

const node = (nodeId: string, groupId?: string) => ({
  nodeId,
  type: "default" as const,
  title: nodeId,
  ...(groupId ? { groupId } : {}),
});
const edge = (edgeId: string, sourceNodeId: string, targetNodeId: string) => ({
  edgeId,
  type: "default" as const,
  sourceNodeId,
  targetNodeId,
});

describe("dependency graph layout", () => {
  it("places SCC peers in one dependency level and their dependencies below without overlap", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [],
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a-b", "a", "b"), edge("b-a", "b", "a"), edge("b-c", "b", "c"), edge("c-d", "c", "d")],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const y = (id: string) => absolutePosition(layout, id).y;

    expect(y("a")).toBe(y("b"));
    expect(y("a")).toBeLessThan(y("c"));
    expect(y("c")).toBeLessThan(y("d"));
    expect(doesNotOverlap(layout, "a", "b")).toBe(true);
    expect(layout.edges.map(({ id }) => id)).toEqual(graph.edges.map(({ edgeId }) => edgeId));
    expect(layout.initialView).toEqual({ mode: "fit" });
  });

  it("orders nested groups and direct files together without a visible virtual group", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "app", title: "App" },
        { groupId: "library", title: "Library" },
        { groupId: "nested", title: "Nested", parentGroupId: "app" },
        { groupId: "deep", title: "Deep", parentGroupId: "nested" },
        { groupId: "sibling", title: "Sibling", parentGroupId: "app" },
      ],
      nodes: [
        node("direct-a", "app"),
        node("direct-b", "app"),
        node("deep-file", "deep"),
        node("sibling-file", "sibling"),
        node("library-file", "library"),
        node("root-file"),
      ],
      edges: [
        edge("direct-order", "direct-a", "direct-b"),
        edge("direct-to-sibling", "direct-b", "sibling-file"),
        edge("nested-to-sibling", "deep-file", "sibling-file"),
        edge("app-to-library", "sibling-file", "library-file"),
        edge("library-to-root", "library-file", "root-file"),
      ],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const y = (id: string) => absolutePosition(layout, id).y;

    expect(layout.groups.map(({ id }) => id).toSorted()).toEqual(graph.groups.map(({ groupId }) => groupId).toSorted());
    expect(layout.nodes.map(({ id }) => id).toSorted()).toEqual(graph.nodes.map(({ nodeId }) => nodeId).toSorted());
    expect(layout.nodes.find(({ id }) => id === "direct-a")?.parentId).toBe("app");
    expect(layout.nodes.find(({ id }) => id === "root-file")?.parentId).toBeUndefined();
    expect(layout.groups.find(({ id }) => id === "deep")?.parentId).toBe("nested");
    expect(y("app")).toBeLessThan(y("library"));
    expect(y("library")).toBeLessThan(y("root-file"));
    expect(y("nested")).toBeLessThan(y("sibling"));
    expect(y("direct-a")).toBeLessThan(y("direct-b"));
    expect(doesNotOverlap(layout, "nested", "sibling")).toBe(true);
    expect(doesNotOverlap(layout, "app", "library")).toBe(true);
  });

  it("keeps fixed group padding and separate root and nested layer gaps", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "parent", title: "Parent" },
        { groupId: "peer", title: "Peer" },
        { groupId: "later", title: "Later" },
        { groupId: "child", title: "Child", parentGroupId: "parent" },
        { groupId: "next-child", title: "Next Child", parentGroupId: "parent" },
      ],
      nodes: [node("first", "child"), node("second", "next-child"), node("outside", "later")],
      edges: [edge("internal", "first", "second"), edge("external", "second", "outside")],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const group = (id: string) => {
      const placement = layout.groups.find((entry) => entry.id === id);
      if (!placement) throw new Error(`Missing group: ${id}`);
      return placement;
    };
    const parent = group("parent");
    const child = group("child");
    const next = group("next-child");
    const later = group("later");
    const parentPosition = absolutePosition(layout, "parent");
    const childPosition = absolutePosition(layout, "child");
    const nextPosition = absolutePosition(layout, "next-child");

    expect(child.position.y).toBe(96);
    expect(child.position.x).toBeGreaterThanOrEqual(80);
    expect(absolutePosition(layout, "first").y - childPosition.y).toBe(96);
    expect(nextPosition.y - childPosition.y - child.size.height).toBe(128);
    expect(parent.size.height - (next.position.y + next.size.height)).toBe(80);
    expect(later.position.y - parentPosition.y - parent.size.height).toBe(192);
    expect(group("peer").position.y).toBe(parent.position.y);
    expect(group("peer").position.x - parent.position.x - parent.size.width).toBe(256);
  });

  it("keeps cyclic sibling groups at the same level and their dependent group below", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "first", title: "First" },
        { groupId: "second", title: "Second" },
        { groupId: "dependency", title: "Dependency" },
      ],
      nodes: [node("a", "first"), node("b", "second"), node("c", "dependency")],
      edges: [edge("a-b", "a", "b"), edge("b-a", "b", "a"), edge("b-c", "b", "c")],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));

    expect(absolutePosition(layout, "first").y).toBe(absolutePosition(layout, "second").y);
    expect(absolutePosition(layout, "second").y).toBeLessThan(absolutePosition(layout, "dependency").y);
    expect(doesNotOverlap(layout, "first", "second")).toBe(true);
  });

  it("orders a long valid chain without recursive traversal overflow", async () => {
    const count = 12_000;
    const graph = {
      groups: [],
      nodes: Array.from({ length: count }, (_, index) => node(`file-${index}`)),
      edges: Array.from({ length: count - 1 }, (_, index) =>
        edge(`dependency-${index}`, `file-${index}`, `file-${index + 1}`),
      ),
    } satisfies DependencyDiagramGraph;
    const layout = await layoutDependencyGraph(graph, sizes(graph));

    expect(layout.nodes).toHaveLength(count);
    expect(layout.edges).toHaveLength(count - 1);
    expect(absolutePosition(layout, "file-0").y).toBeLessThan(absolutePosition(layout, `file-${count - 1}`).y);
  });

  it("keeps wide same-level sibling groups alongside one another", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: ["first", "second", "third", "fourth"].map((groupId) => ({ groupId, title: groupId })),
      nodes: [node("a", "first"), node("b", "second"), node("c", "third"), node("d", "fourth")],
      edges: [],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));

    expect(new Set(layout.groups.map(({ id }) => absolutePosition(layout, id).y)).size).toBe(1);
    expect(doesNotOverlap(layout, "first", "second")).toBe(true);
    expect(doesNotOverlap(layout, "third", "fourth")).toBe(true);
  });

  it("reserves empty group space and loops above a node without crossing its same-row sibling", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [{ groupId: "empty", title: "Empty" }],
      nodes: [node("file"), node("sibling")],
      edges: [edge("self", "file", "file")],
    });
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const empty = layout.groups.find(({ id }) => id === "empty");
    const file = layout.nodes.find(({ id }) => id === "file");
    const route = layout.edges.find(({ id }) => id === "self")?.points;
    const filePosition = absolutePosition(layout, "file");

    expect(empty?.size.width).toBeGreaterThan(0);
    expect(empty?.size.height).toBeGreaterThan(0);
    expect(file).toBeDefined();
    expect(absolutePosition(layout, "sibling").y).toBe(filePosition.y);
    expect(route?.length).toBeGreaterThan(2);
    expect(route?.some(({ y }) => y < filePosition.y)).toBe(true);
    expect(route?.every(({ x }) => x >= filePosition.x && x <= filePosition.x + (file?.size.width ?? 0))).toBe(true);
  });

  it("preserves the full layout for unordered groups, unequal depths and virtual ID collisions", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "leaf", title: "Leaf", parentGroupId: "middle", type: "default" },
        { groupId: "direct-nodes:", title: "Child", parentGroupId: "direct-nodes", type: "default" },
        { groupId: "direct-nodes", title: "Parent", type: "default" },
        { groupId: "middle", title: "Middle", parentGroupId: "direct-nodes", type: "default" },
        { groupId: "empty", title: "Empty", type: "default" },
      ],
      nodes: [
        { nodeId: "a", title: "a", groupId: "leaf", type: "default" },
        { nodeId: "r", title: "r", type: "default" },
        { nodeId: "b", title: "b", groupId: "direct-nodes", type: "default" },
        { nodeId: "s", title: "s", type: "default" },
        { nodeId: "c", title: "c", groupId: "direct-nodes:", type: "default" },
      ],
      edges: [
        { edgeId: "a-b", type: "default", sourceNodeId: "a", targetNodeId: "b" },
        { edgeId: "b-a", type: "default", sourceNodeId: "b", targetNodeId: "a" },
        { edgeId: "r-a", type: "default", sourceNodeId: "r", targetNodeId: "a" },
        { edgeId: "c-r", type: "default", sourceNodeId: "c", targetNodeId: "r" },
        { edgeId: "a-c", type: "default", sourceNodeId: "a", targetNodeId: "c" },
        { edgeId: "s-r", type: "default", sourceNodeId: "s", targetNodeId: "r" },
      ],
    });
    const nodeSizes = {
      a: { width: 288, height: 58 },
      r: { width: 320, height: 78 },
      b: { width: 352, height: 98 },
      s: { width: 384, height: 118 },
      c: { width: 416, height: 138 },
    };

    expect(await layoutDependencyGraph(graph, nodeSizes)).toEqual({
      groups: [
        { id: "direct-nodes", position: { x: 48, y: 48 }, size: { width: 1248, height: 1028 } },
        {
          id: "direct-nodes:",
          parentId: "direct-nodes",
          position: { x: 336, y: 634 },
          size: { width: 576, height: 314 },
        },
        { id: "middle", parentId: "direct-nodes", position: { x: 80, y: 96 }, size: { width: 608, height: 410 } },
        { id: "leaf", parentId: "middle", position: { x: 80, y: 96 }, size: { width: 448, height: 234 } },
        { id: "empty", position: { x: 2192, y: 48 }, size: { width: 448, height: 176 } },
      ],
      nodes: [
        { id: "c", position: { x: 80, y: 96 }, size: { width: 416, height: 138 }, parentId: "direct-nodes:" },
        { id: "a", position: { x: 80, y: 96 }, size: { width: 288, height: 58 }, parentId: "leaf" },
        { id: "b", position: { x: 816, y: 96 }, size: { width: 352, height: 98 }, parentId: "direct-nodes" },
        { id: "r", position: { x: 1584, y: 262 }, size: { width: 320, height: 78 } },
        { id: "s", position: { x: 1552, y: 48 }, size: { width: 384, height: 118 } },
      ],
      edges: [
        {
          id: "a-b",
          points: [
            { x: 576, y: 365 },
            { x: 864, y: 193 },
          ],
        },
        {
          id: "b-a",
          points: [
            { x: 864, y: 193 },
            { x: 576, y: 365 },
          ],
        },
        {
          id: "r-a",
          points: [
            { x: 1584, y: 301 },
            { x: 576, y: 365 },
          ],
        },
        {
          id: "c-r",
          points: [
            { x: 880, y: 847 },
            { x: 1584, y: 301 },
          ],
        },
        {
          id: "a-c",
          points: [
            { x: 432, y: 394 },
            { x: 672, y: 778 },
          ],
        },
        {
          id: "s-r",
          points: [
            { x: 1744, y: 166 },
            { x: 1744, y: 262 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    });
  });

  it("preserves the full multigraph layout with cycles, parallel edges and self loops", async () => {
    const graph = dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "left", title: "left", type: "default" },
        { groupId: "right", title: "right", type: "default" },
        { groupId: "tail", title: "tail", type: "default" },
      ],
      nodes: [
        { nodeId: "a", title: "a", groupId: "left", type: "default" },
        { nodeId: "b", title: "b", groupId: "left", type: "default" },
        { nodeId: "c", title: "c", groupId: "right", type: "default" },
        { nodeId: "d", title: "d", groupId: "tail", type: "default" },
        { nodeId: "e", title: "e", type: "default" },
      ],
      edges: [
        { edgeId: "a-b", type: "default", sourceNodeId: "a", targetNodeId: "b" },
        { edgeId: "a-c", type: "default", sourceNodeId: "a", targetNodeId: "c" },
        { edgeId: "b-a", type: "default", sourceNodeId: "b", targetNodeId: "a" },
        { edgeId: "a-loop", type: "default", sourceNodeId: "a", targetNodeId: "a" },
        { edgeId: "c-a", type: "default", sourceNodeId: "c", targetNodeId: "a" },
        { edgeId: "parallel", type: "default", sourceNodeId: "a", targetNodeId: "c" },
        { edgeId: "c-d", type: "default", sourceNodeId: "c", targetNodeId: "d" },
        { edgeId: "e-loop", type: "default", sourceNodeId: "e", targetNodeId: "e" },
      ],
    });
    const nodeSizes = {
      a: { width: 288, height: 58 },
      b: { width: 320, height: 78 },
      c: { width: 352, height: 98 },
      d: { width: 384, height: 118 },
      e: { width: 416, height: 138 },
    };

    expect(await layoutDependencyGraph(graph, nodeSizes)).toEqual({
      groups: [
        { id: "left", position: { x: 48, y: 48 }, size: { width: 832, height: 254 } },
        { id: "right", position: { x: 1136, y: 48 }, size: { width: 512, height: 274 } },
        { id: "tail", position: { x: 912, y: 514 }, size: { width: 544, height: 294 } },
      ],
      nodes: [
        { id: "a", position: { x: 80, y: 96 }, size: { width: 288, height: 58 }, parentId: "left" },
        { id: "b", position: { x: 432, y: 96 }, size: { width: 320, height: 78 }, parentId: "left" },
        { id: "c", position: { x: 80, y: 96 }, size: { width: 352, height: 98 }, parentId: "right" },
        { id: "d", position: { x: 80, y: 96 }, size: { width: 384, height: 118 }, parentId: "tail" },
        { id: "e", position: { x: 1904, y: 48 }, size: { width: 416, height: 138 } },
      ],
      edges: [
        {
          id: "a-b",
          points: [
            { x: 416, y: 173 },
            { x: 480, y: 183 },
          ],
        },
        {
          id: "a-c",
          points: [
            { x: 416, y: 173 },
            { x: 1216, y: 193 },
          ],
        },
        {
          id: "b-a",
          points: [
            { x: 480, y: 183 },
            { x: 416, y: 173 },
          ],
        },
        {
          id: "a-loop",
          points: [
            { x: 344, y: 144 },
            { x: 344, y: 128 },
            { x: 200, y: 128 },
            { x: 200, y: 144 },
          ],
        },
        {
          id: "c-a",
          points: [
            { x: 1216, y: 193 },
            { x: 416, y: 173 },
          ],
        },
        {
          id: "parallel",
          points: [
            { x: 416, y: 173 },
            { x: 1216, y: 193 },
          ],
        },
        {
          id: "c-d",
          points: [
            { x: 1392, y: 242 },
            { x: 1184, y: 610 },
          ],
        },
        {
          id: "e-loop",
          points: [
            { x: 2216, y: 48 },
            { x: 2216, y: 32 },
            { x: 2008, y: 32 },
            { x: 2008, y: 48 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    });
  });
});
