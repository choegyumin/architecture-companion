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
      groupActivatable: true,
    });
    const aggregate = model.edges.find((edge) => edge.source === "app" && edge.target === "library");
    if (aggregate?.type !== "route") throw new Error("Missing aggregate route");
    const app = model.nodes.find((node) => node.id === "app");
    if (app?.type !== "labeled-group") throw new Error("Missing group");

    expect(model.edges).toHaveLength(1);
    expect(aggregate.data?.path).toMatch(/^M .+ C /);
    expect(model.edgeTargets?.get(aggregate.id)).toEqual({
      type: "edge-set",
      sourceId: "app",
      targetId: "library",
      edgeIds: ["a-c", "b-c"],
    });
    expect(app.data.activatable).toBe(true);
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
  });

  it("renders only selected original edges and preserves their individual targets", async () => {
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const model = buildDependencyGraphDiagramReactFlowRenderModel(diagram, layout, vi.fn(), {
      focus: { type: "aggregate", edgeIds: ["b-c", "a-c"] },
    });

    expect(model.edges.map(({ id }) => id)).toEqual(["b-c", "a-c"]);
    expect(model.edges.every((edge) => edge.type === "route" && edge.data?.path.startsWith("M "))).toBe(true);
    expect(model.edges.find(({ id }) => id === "a-c")?.label).toBe("Uses C");
    expect(model.edgeTargets?.size).toBe(0);
  });
});
