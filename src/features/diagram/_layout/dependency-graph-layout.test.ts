import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramNodeSizes } from "@/features/diagram/diagram-spatial";

function sizes(graph: DiagramGraph): DiagramNodeSizes {
  return Object.fromEntries(graph.nodes.map(({ id }) => [id, { width: 288, height: 144 }]));
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

const node = (id: string, groupId?: string) => ({
  id,
  type: "default" as const,
  title: id,
  ...(groupId ? { groupId } : {}),
});
const edge = (id: string, source: string, target: string) => ({ id, type: "default" as const, source, target });

describe("dependency graph layout", () => {
  it("places SCC peers in one dependency level and their dependencies below without overlap", async () => {
    const graph = {
      groups: [],
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a-b", "a", "b"), edge("b-a", "b", "a"), edge("b-c", "b", "c"), edge("c-d", "c", "d")],
    } satisfies DiagramGraph;
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const y = (id: string) => absolutePosition(layout, id).y;

    expect(y("a")).toBe(y("b"));
    expect(y("a")).toBeLessThan(y("c"));
    expect(y("c")).toBeLessThan(y("d"));
    expect(doesNotOverlap(layout, "a", "b")).toBe(true);
    expect(layout.edges.map(({ id }) => id)).toEqual(graph.edges.map(({ id }) => id));
    expect(layout.initialView).toEqual({ mode: "fit" });
  });

  it("orders nested groups and direct files together without a visible virtual group", async () => {
    const graph = {
      groups: [
        { id: "app", title: "App" },
        { id: "library", title: "Library" },
        { id: "nested", title: "Nested", parentId: "app" },
        { id: "deep", title: "Deep", parentId: "nested" },
        { id: "sibling", title: "Sibling", parentId: "app" },
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
    } satisfies DiagramGraph;
    const layout = await layoutDependencyGraph(graph, sizes(graph));
    const y = (id: string) => absolutePosition(layout, id).y;

    expect(layout.groups.map(({ id }) => id).toSorted()).toEqual(graph.groups.map(({ id }) => id).toSorted());
    expect(layout.nodes.map(({ id }) => id).toSorted()).toEqual(graph.nodes.map(({ id }) => id).toSorted());
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
    const graph = {
      groups: [
        { id: "parent", title: "Parent" },
        { id: "peer", title: "Peer" },
        { id: "later", title: "Later" },
        { id: "child", title: "Child", parentId: "parent" },
        { id: "next-child", title: "Next Child", parentId: "parent" },
      ],
      nodes: [node("first", "child"), node("second", "next-child"), node("outside", "later")],
      edges: [edge("internal", "first", "second"), edge("external", "second", "outside")],
    } satisfies DiagramGraph;
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
    const graph = {
      groups: [
        { id: "first", title: "First" },
        { id: "second", title: "Second" },
        { id: "dependency", title: "Dependency" },
      ],
      nodes: [node("a", "first"), node("b", "second"), node("c", "dependency")],
      edges: [edge("a-b", "a", "b"), edge("b-a", "b", "a"), edge("b-c", "b", "c")],
    } satisfies DiagramGraph;
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
    } satisfies DiagramGraph;
    const layout = await layoutDependencyGraph(graph, sizes(graph));

    expect(layout.nodes).toHaveLength(count);
    expect(layout.edges).toHaveLength(count - 1);
    expect(absolutePosition(layout, "file-0").y).toBeLessThan(absolutePosition(layout, `file-${count - 1}`).y);
  });

  it("keeps wide same-level sibling groups alongside one another", async () => {
    const graph = {
      groups: ["first", "second", "third", "fourth"].map((id) => ({ id, title: id })),
      nodes: [node("a", "first"), node("b", "second"), node("c", "third"), node("d", "fourth")],
      edges: [],
    } satisfies DiagramGraph;
    const layout = await layoutDependencyGraph(graph, sizes(graph));

    expect(new Set(layout.groups.map(({ id }) => absolutePosition(layout, id).y)).size).toBe(1);
    expect(doesNotOverlap(layout, "first", "second")).toBe(true);
    expect(doesNotOverlap(layout, "third", "fourth")).toBe(true);
  });

  it("reserves empty group space and loops above a node without crossing its same-row sibling", async () => {
    const graph = {
      groups: [{ id: "empty", title: "Empty" }],
      nodes: [node("file"), node("sibling")],
      edges: [edge("self", "file", "file")],
    } satisfies DiagramGraph;
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
});
