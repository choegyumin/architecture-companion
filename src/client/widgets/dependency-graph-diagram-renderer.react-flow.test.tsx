import { buildDependencyGraphDiagramReactFlowRenderModel } from "@/client/widgets/dependency-graph-diagram-renderer.react-flow";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import type { Diagram } from "@/features/diagram/diagram";

const diagram = {
  id: "dependencies",
  title: "Dependencies",
  generator: "built-in:freeform",
  layout: { id: "dependency-graph" },
  graph: {
    groups: [
      { id: "app", title: "App" },
      { id: "nested", title: "Nested", parentId: "app" },
      { id: "library", title: "Library" },
    ],
    nodes: [
      { id: "a", type: "default", title: "A", groupId: "app" },
      { id: "b", type: "default", title: "B", groupId: "nested" },
      { id: "c", type: "default", title: "C", groupId: "library" },
    ],
    edges: [
      { id: "a-c", type: "default", source: "a", target: "c", label: "Uses C" },
      { id: "b-c", type: "default", source: "b", target: "c" },
      { id: "b-a", type: "default", source: "b", target: "a" },
    ],
  },
} satisfies Diagram;

const sizes = {
  a: { width: 288, height: 144 },
  b: { width: 288, height: 144 },
  c: { width: 288, height: 144 },
};

describe("dependency graph React Flow adapter", () => {
  it("renders directed aggregates with original membership, shape focus and comment snapshots", async () => {
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const onAggregateActivate = vi.fn();
    const model = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn(), {
      onAggregateActivate,
      nodesActivatable: true,
    });
    const aggregate = model.edges.find((edge) => edge.source === "app" && edge.target === "library");
    if (aggregate?.type !== "route") throw new Error("Missing aggregate route");
    const app = model.nodes.find((node) => node.id === "app");
    if (app?.type !== "labeled-group") throw new Error("Missing group");
    const card = model.nodes.find((node) => node.id === "a");
    if (card?.type !== "card") throw new Error("Missing card");

    expect(model.edges).toHaveLength(1);
    expect(aggregate.markerEnd).toMatchObject({ color: "var(--diagram-edge)" });
    expect(aggregate.style).toMatchObject({ stroke: "var(--diagram-edge)" });
    expect(aggregate.data?.path).toMatch(/^M .+ L /);
    expect(aggregate.data?.path).not.toContain(" C ");
    expect(model.edgeTargets?.get(aggregate.id)).toEqual({
      type: "edge-set",
      sourceId: "app",
      targetId: "library",
      edgeIds: ["a-c", "b-c"],
    });
    expect(app.data.activatable).toBe(true);
    expect(card.data.activatable).toBe(true);
    expect(app.data).not.toHaveProperty("onTitleActivate");
    expect(aggregate.data?.eyebrow).toBe("×2");
    expect(aggregate.data?.labelAction?.ariaLabel).toBe("Show 2 edges from app to library");
    aggregate.data?.labelAction?.onActivate();
    expect(onAggregateActivate).toHaveBeenCalledWith(["a-c", "b-c"]);

    const commentModel = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn());
    const commentAggregate = commentModel.edges.at(0);
    if (commentAggregate?.type !== "route") throw new Error("Missing comment aggregate");
    expect(commentAggregate.data?.eyebrow).toBe("×2");
    expect(commentAggregate.data?.labelAction).toBeUndefined();
    expect(commentModel.nodes.find((node) => node.id === "app")?.data).not.toHaveProperty("activatable");
    expect(commentModel.nodes.find((node) => node.id === "a")?.data).not.toHaveProperty("activatable");
  });

  it("renders only selected original edges and preserves their individual targets", async () => {
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const model = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn(), {
      focus: { type: "aggregate", edgeIds: ["b-c", "a-c"] },
    });

    expect(model.edges.map(({ id }) => id)).toEqual(["b-c", "a-c"]);
    expect(model.edges.every((edge) => edge.type === "route" && edge.data?.path.includes(" C "))).toBe(true);
    expect(model.edges.find(({ id }) => id === "a-c")?.label).toBe("Uses C");
    expect(model.edgeTargets?.size).toBe(0);
  });

  it("routes original and aggregate relations by their rendered endpoints during group focus", async () => {
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const model = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn(), {
      focus: { type: "group", id: "app" },
    });
    const internal = model.edges.find((edge) => edge.id === "b-a");
    const boundary = model.edges.find((edge) => edge.source === "app" && edge.target === "library");

    expect(internal?.type === "route" && internal.data?.path).toContain(" C ");
    expect(boundary?.type === "route" && boundary.data?.path).not.toContain(" C ");
    expect(boundary?.type === "route" && boundary.data?.path).toContain(" L ");
  });

  it("routes a focused nested group's boundary to its ancestor without invalid coordinates", async () => {
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const model = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn(), {
      focus: { type: "group", id: "nested" },
    });
    const ancestor = model.edges.find((edge) => edge.source === "nested" && edge.target === "app");
    if (ancestor?.type !== "route") throw new Error("Missing nested boundary");

    expect(ancestor.data?.path).toMatch(/^M .+ L /);
    expect(ancestor.data?.path).not.toMatch(/NaN|Infinity| C /);
  });

  it("uses separate orthogonal group–node routes for both directions", async () => {
    const withRoot = {
      ...diagram,
      graph: {
        ...diagram.graph,
        nodes: [...diagram.graph.nodes, { id: "root", type: "default", title: "Root" }],
        edges: [
          ...diagram.graph.edges,
          { id: "a-root", type: "default", source: "a", target: "root" },
          { id: "root-a", type: "default", source: "root", target: "a" },
        ],
      },
    } satisfies Diagram;
    const layout = await layoutDependencyGraph(withRoot.graph, { ...sizes, root: sizes.a });
    const model = buildDependencyGraphDiagramReactFlowRenderModel(withRoot, layout, vi.fn());
    const forward = model.edges.find((edge) => edge.source === "app" && edge.target === "root");
    const reverse = model.edges.find((edge) => edge.source === "root" && edge.target === "app");

    expect(forward?.type === "route" && forward.data?.path).toMatch(/^M (?!.* C ).+ L /);
    expect(reverse?.type === "route" && reverse.data?.path).toMatch(/^M (?!.* C ).+ L /);
    expect(forward?.type === "route" && model.edgeTargets?.get(forward.id)).toMatchObject({ edgeIds: ["a-root"] });
    expect(reverse?.type === "route" && model.edgeTargets?.get(reverse.id)).toMatchObject({ edgeIds: ["root-a"] });
  });

  it("uses F curves for node–node aggregates between ungrouped root nodes", async () => {
    const roots = {
      ...diagram,
      graph: {
        ...diagram.graph,
        nodes: [
          ...diagram.graph.nodes,
          { id: "root-one", type: "default", title: "Root One" },
          { id: "root-two", type: "default", title: "Root Two" },
        ],
        edges: [
          ...diagram.graph.edges,
          { id: "one-two", type: "default", source: "root-one", target: "root-two" },
          { id: "two-one", type: "default", source: "root-two", target: "root-one" },
        ],
      },
    } satisfies Diagram;
    const layout = await layoutDependencyGraph(roots.graph, {
      ...sizes,
      "root-one": sizes.a,
      "root-two": sizes.a,
    });
    const model = buildDependencyGraphDiagramReactFlowRenderModel(roots, layout, vi.fn());
    const forward = model.edges.find((edge) => edge.source === "root-one" && edge.target === "root-two");
    const reverse = model.edges.find((edge) => edge.source === "root-two" && edge.target === "root-one");

    expect(forward?.type === "route" && forward.data?.path).toContain(" C ");
    expect(reverse?.type === "route" && reverse.data?.path).toContain(" C ");
    expect(forward?.type === "route" && model.edgeTargets?.get(forward.id)).toMatchObject({
      edgeIds: ["one-two"],
    });
    expect(reverse?.type === "route" && model.edgeTargets?.get(reverse.id)).toMatchObject({
      edgeIds: ["two-one"],
    });
  });
});
