import { layoutElkLayeredDiagram, straightenLayeredEdges } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const diagramBase = {
  groups: [],
} as const;

const groupedDiagram = {
  ...diagramBase,
  groups: [{ id: "checkout", title: "Checkout" }],
  nodes: [
    {
      id: "checkout-page",
      type: "default",
      kind: "component",
      title: "Checkout page",
      groupId: "checkout",
    },
    {
      id: "payment-client",
      type: "default",
      kind: "component",
      title: "Payment client",
      groupId: "checkout",
    },
  ],
  edges: [
    {
      id: "uses-payment-client",
      type: "default",
      source: "checkout-page",
      target: "payment-client",
    },
  ],
} satisfies DiagramGraph;

const groupedNodeSizes = {
  "checkout-page": { width: 288, height: 176 },
  "payment-client": { width: 288, height: 144 },
} as const;

const directionDiagram = {
  ...diagramBase,
  groups: [],
  nodes: [
    { id: "source", type: "default", kind: "source", title: "Source" },
    { id: "target", type: "default", kind: "target", title: "Target" },
  ],
  edges: [{ id: "source-target", type: "default", source: "source", target: "target" }],
} satisfies DiagramGraph;

const directionNodeSizes = {
  source: { width: 100, height: 100 },
  target: { width: 100, height: 100 },
} as const;

describe("ELK layered diagram layout", () => {
  it("places the root near the graph center in a tree mixing deep chains and a wide fan", async () => {
    const diagram = {
      ...diagramBase,
      nodes: [
        { id: "root", type: "default", kind: "source", title: "Root" },
        { id: "spine-mid", type: "default", kind: "source", title: "Spine mid" },
        { id: "spine-deep", type: "default", kind: "source", title: "Spine deep" },
        { id: "fan-a", type: "default", kind: "source", title: "Fan A" },
        { id: "fan-b", type: "default", kind: "source", title: "Fan B" },
        { id: "fan-c", type: "default", kind: "source", title: "Fan C" },
      ],
      edges: [
        { id: "root-spine-mid", type: "default", source: "root", target: "spine-mid" },
        { id: "spine-mid-deep", type: "default", source: "spine-mid", target: "spine-deep" },
        { id: "root-fan-a", type: "default", source: "root", target: "fan-a" },
        { id: "root-fan-b", type: "default", source: "root", target: "fan-b" },
        { id: "root-fan-c", type: "default", source: "root", target: "fan-c" },
      ],
    } satisfies DiagramGraph;
    const nodeSizes = Object.fromEntries(diagram.nodes.map(({ id }) => [id, { width: 288, height: 176 }]));

    const result = await layoutElkLayeredDiagram(diagram, nodeSizes);
    const root = result.nodes.find(({ id }) => id === "root");
    const graphMinX = Math.min(...result.nodes.map(({ position }) => position.x));
    const graphMaxX = Math.max(...result.nodes.map(({ position, size }) => position.x + size.width));
    const rootCenterX = (root?.position.x ?? 0) + (root?.size.width ?? 0) / 2;

    expect(Math.abs(rootCenterX - (graphMinX + graphMaxX) / 2)).toBeLessThanOrEqual((graphMaxX - graphMinX) / 4);
  });

  it("lays out top to bottom by default", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.y).toBeGreaterThan(source?.position.y ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "center", y: "clamp" });
  });

  it("accepts a direction per layout request", async () => {
    const options = { direction: "RIGHT" } as const;
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, options);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.x).toBeGreaterThan(source?.position.x ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "clamp", y: "center" });
  });

  it("marks edges for spline rendering when edgeRouting is SPLINES", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      direction: "RIGHT",
      edgeRouting: "SPLINES",
    });

    expect(result.edges).toEqual([expect.objectContaining({ id: "source-target", routing: "spline" })]);
  });

  it("keeps polyline edges when edgeRouting is omitted or orthogonal", async () => {
    const defaults = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes);
    const orthogonal = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      edgeRouting: "ORTHOGONAL",
    });

    expect(defaults.edges.at(0)).not.toHaveProperty("routing");
    expect(orthogonal.edges.at(0)).not.toHaveProperty("routing");
  });

  it("keeps the fitted viewport even when the graph has multiple roots", async () => {
    const diagram = {
      ...directionDiagram,
      edges: [],
    } satisfies DiagramGraph;

    const result = await layoutElkLayeredDiagram(diagram, directionNodeSizes);

    expect(result.initialView).toEqual({ mode: "fit" });
  });

  it("reserves header width for an empty group without overlapping its sibling", async () => {
    const diagram = {
      ...diagramBase,
      groups: [
        { id: "empty", title: "Empty" },
        { id: "sibling", title: "Sibling" },
      ],
      nodes: [{ id: "solo", type: "default", kind: "source", title: "Solo", groupId: "sibling" }],
      edges: [],
    } satisfies DiagramGraph;

    const result = await layoutElkLayeredDiagram(diagram, { solo: { width: 100, height: 100 } });
    const empty = result.groups.find(({ id }) => id === "empty");
    const sibling = result.groups.find(({ id }) => id === "sibling");

    expect(empty?.size).toEqual({ width: 352, height: 128 });
    expect(sibling).toBeDefined();
    if (!empty || !sibling) return;

    const overlapsHorizontally =
      empty.position.x < sibling.position.x + sibling.size.width &&
      sibling.position.x < empty.position.x + empty.size.width;
    const overlapsVertically =
      empty.position.y < sibling.position.y + sibling.size.height &&
      sibling.position.y < empty.position.y + empty.size.height;
    expect(overlapsHorizontally && overlapsVertically).toBe(false);
  });

  it("rejects nodes with a missing measured size", async () => {
    await expect(layoutElkLayeredDiagram(directionDiagram, { source: directionNodeSizes.source })).rejects.toThrow(
      "Missing measured node size: target",
    );
  });

  it("returns provider-agnostic placement and directed edge routes", async () => {
    const result = await layoutElkLayeredDiagram(groupedDiagram, groupedNodeSizes);

    expect(result.nodes.map(({ id }) => id)).toEqual(["checkout-page", "payment-client"]);
    expect(result.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    expect(result.groups).toEqual([
      expect.objectContaining({
        id: "checkout",
        size: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      }),
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        id: "uses-payment-client",
        points: [expect.any(Object), expect.any(Object)],
      }),
    ]);
  });

  it("keeps ELK routing and node placement when nudgeObstacleNodes is omitted", async () => {
    const diagram = {
      ...diagramBase,
      nodes: [
        { id: "source", type: "default", kind: "source", title: "Source" },
        { id: "obstacle", type: "default", kind: "component", title: "Obstacle" },
        { id: "target", type: "default", kind: "target", title: "Target" },
      ],
      edges: [
        { id: "source-obstacle", type: "default", source: "source", target: "obstacle" },
        { id: "obstacle-target", type: "default", source: "obstacle", target: "target" },
        { id: "source-target", type: "default", source: "source", target: "target" },
      ],
    } satisfies DiagramGraph;
    const nodeSizes = Object.fromEntries(diagram.nodes.map(({ id }) => [id, { width: 100, height: 100 }]));

    const defaults = await layoutElkLayeredDiagram(diagram, nodeSizes);
    const nudged = await layoutElkLayeredDiagram(diagram, nodeSizes, { nudgeObstacleNodes: true });

    // The three-node column shares one x, so the long source-target sightline runs
    // through the obstacle; the flag must move it off that line.
    const defaultObstacleX = defaults.nodes.find(({ id }) => id === "obstacle")?.position.x;
    expect(nudged.nodes.find(({ id }) => id === "obstacle")?.position.x).not.toBe(defaultObstacleX);
    expect(nudged.edges.find(({ id }) => id === "source-target")?.points).toHaveLength(2);
  });
});

function toStraightenedLayout(
  nodes: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number; parentId?: string }>,
  edges: ReadonlyArray<{ id: string }>,
  groups: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number; parentId?: string }> = [],
): DiagramLayout {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
    })),
    groups: groups.map((group) => ({
      id: group.id,
      ...(group.parentId ? { parentId: group.parentId } : {}),
      position: { x: group.x, y: group.y },
      size: { width: group.width, height: group.height },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    })),
    initialView: { mode: "fit" },
  };
}

function toStraightenedGraph(edgeSpecs: ReadonlyArray<{ id: string; source: string; target: string }>): DiagramGraph {
  return {
    groups: [],
    nodes: [],
    edges: edgeSpecs.map((edge) => ({ ...edge, type: "default" })),
  } as unknown as DiagramGraph;
}

describe("straightenLayeredEdges", () => {
  it("replaces a clear edge with a single border-to-border segment and leaves nodes in place", () => {
    const layout = toStraightenedLayout(
      [
        { id: "source", x: 0, y: 0, width: 100, height: 100 },
        { id: "target", x: 0, y: 600, width: 100, height: 100 },
      ],
      [{ id: "source-target" }],
    );

    const result = straightenLayeredEdges(
      toStraightenedGraph([{ id: "source-target", source: "source", target: "target" }]),
      layout,
      "DOWN",
    );

    expect(result.edges).toEqual([
      {
        id: "source-target",
        points: [
          { x: 50, y: 100 },
          { x: 50, y: 600 },
        ],
      },
    ]);
    expect(result.nodes.map(({ id, position }) => [id, position])).toEqual([
      ["source", { x: 0, y: 0 }],
      ["target", { x: 0, y: 600 }],
    ]);
  });

  it("nudges an obstacle node clear of the sightline", () => {
    const graph = toStraightenedGraph([{ id: "source-target", source: "source", target: "target" }]);
    const layout = toStraightenedLayout(
      [
        { id: "source", x: 0, y: 0, width: 100, height: 100 },
        { id: "obstacle", x: 0, y: 300, width: 100, height: 100 },
        { id: "target", x: 0, y: 600, width: 100, height: 100 },
      ],
      [{ id: "source-target" }],
    );

    const result = straightenLayeredEdges(graph, layout, "DOWN");
    const obstacle = result.nodes.find(({ id }) => id === "obstacle");

    // The sightline runs at x = 50; the obstacle center starts on it, so it must
    // move by half-width + clearance = 90.
    expect(obstacle?.position.x).toBe(90);
    expect(result.edges.find(({ id }) => id === "source-target")?.points).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 600 },
    ]);
  });

  it("keeps a nudged node inside its parent group", () => {
    const graph = toStraightenedGraph([{ id: "source-target", source: "source", target: "target" }]);
    const layout = toStraightenedLayout(
      [
        { id: "source", x: 0, y: 0, width: 100, height: 100 },
        { id: "obstacle", x: 0, y: 50, width: 100, height: 100, parentId: "group" },
        { id: "target", x: 0, y: 600, width: 100, height: 100 },
      ],
      [{ id: "source-target" }],
      [{ id: "group", x: 0, y: 250, width: 200, height: 300 }],
    );

    const result = straightenLayeredEdges(graph, layout, "DOWN");
    const obstacle = result.nodes.find(({ id }) => id === "obstacle");

    // Group spans x in [0, 200]; the widest allowed center is 200 - 16 - 50 = 134,
    // so the requested 90px nudge clamps to 84.
    expect(obstacle?.position.x).toBe(84);
  });

  it("nudges along the vertical axis for horizontal flow directions", () => {
    const graph = toStraightenedGraph([{ id: "source-target", source: "source", target: "target" }]);
    const layout = toStraightenedLayout(
      [
        { id: "source", x: 0, y: 0, width: 100, height: 100 },
        { id: "obstacle", x: 300, y: 0, width: 100, height: 100 },
        { id: "target", x: 600, y: 0, width: 100, height: 100 },
      ],
      [{ id: "source-target" }],
    );

    const result = straightenLayeredEdges(graph, layout, "RIGHT");
    const obstacle = result.nodes.find(({ id }) => id === "obstacle");

    expect(obstacle?.position.y).toBe(90);
    expect(result.edges.find(({ id }) => id === "source-target")?.points).toEqual([
      { x: 100, y: 50 },
      { x: 600, y: 50 },
    ]);
  });

  it("keeps edges it cannot resolve on their original points", () => {
    const layout = toStraightenedLayout(
      [{ id: "source", x: 0, y: 0, width: 100, height: 100 }],
      [{ id: "source-target" }],
    );

    const result = straightenLayeredEdges(
      toStraightenedGraph([{ id: "source-target", source: "source", target: "target" }]),
      layout,
      "DOWN",
    );

    expect(result.edges).toEqual([
      {
        id: "source-target",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]);
  });
});
