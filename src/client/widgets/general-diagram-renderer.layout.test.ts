import type { z } from "zod";

import {
  layoutGeneralDiagram as calculateLayout,
  straightenLayeredEdges,
} from "@/client/widgets/general-diagram-renderer.layout";
import type { GeneralDiagramGraph } from "@/features/diagram/diagram-graph";
import { generalDiagramLayoutConfigSchema } from "@/features/diagram/diagram-layout";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

function layoutGeneralDiagram(
  graph: Parameters<typeof calculateLayout>[0],
  sizes: Parameters<typeof calculateLayout>[1],
  options?: z.input<typeof generalDiagramLayoutConfigSchema>["options"],
) {
  return calculateLayout(
    graph,
    sizes,
    generalDiagramLayoutConfigSchema.parse({ layoutId: "general", options }).options,
  );
}

const diagramBase = {
  groups: [],
} as const;

const groupedDiagram = {
  ...diagramBase,
  groups: [{ type: "default", groupId: "checkout", title: "Checkout" }],
  nodes: [
    {
      nodeId: "checkout-page",
      type: "default",
      kind: "component",
      title: "Checkout page",
      groupId: "checkout",
    },
    {
      nodeId: "payment-client",
      type: "default",
      kind: "component",
      title: "Payment client",
      groupId: "checkout",
    },
  ],
  edges: [
    {
      edgeId: "uses-payment-client",
      type: "default",
      sourceNodeId: "checkout-page",
      targetNodeId: "payment-client",
    },
  ],
} satisfies GeneralDiagramGraph;

const groupedNodeSizes = {
  "checkout-page": { width: 288, height: 176 },
  "payment-client": { width: 288, height: 144 },
} as const;

const directionDiagram = {
  ...diagramBase,
  groups: [],
  nodes: [
    { nodeId: "source", type: "default", kind: "source", title: "Source" },
    { nodeId: "target", type: "default", kind: "target", title: "Target" },
  ],
  edges: [{ edgeId: "source-target", type: "default", sourceNodeId: "source", targetNodeId: "target" }],
} satisfies GeneralDiagramGraph;

const directionNodeSizes = {
  source: { width: 100, height: 100 },
  target: { width: 100, height: 100 },
} as const;

describe("general diagram layout", () => {
  it("places the root near the graph center in a tree mixing deep chains and a wide fan", async () => {
    const diagram = {
      ...diagramBase,
      nodes: [
        { nodeId: "root", type: "default", kind: "source", title: "Root" },
        { nodeId: "spine-mid", type: "default", kind: "source", title: "Spine mid" },
        { nodeId: "spine-deep", type: "default", kind: "source", title: "Spine deep" },
        { nodeId: "fan-a", type: "default", kind: "source", title: "Fan A" },
        { nodeId: "fan-b", type: "default", kind: "source", title: "Fan B" },
        { nodeId: "fan-c", type: "default", kind: "source", title: "Fan C" },
      ],
      edges: [
        { edgeId: "root-spine-mid", type: "default", sourceNodeId: "root", targetNodeId: "spine-mid" },
        { edgeId: "spine-mid-deep", type: "default", sourceNodeId: "spine-mid", targetNodeId: "spine-deep" },
        { edgeId: "root-fan-a", type: "default", sourceNodeId: "root", targetNodeId: "fan-a" },
        { edgeId: "root-fan-b", type: "default", sourceNodeId: "root", targetNodeId: "fan-b" },
        { edgeId: "root-fan-c", type: "default", sourceNodeId: "root", targetNodeId: "fan-c" },
      ],
    } satisfies GeneralDiagramGraph;
    const nodeSizes = Object.fromEntries(diagram.nodes.map(({ nodeId }) => [nodeId, { width: 288, height: 176 }]));

    const result = await layoutGeneralDiagram(diagram, nodeSizes);
    const root = result.nodes.find(({ id }) => id === "root");
    const graphMinY = Math.min(...result.nodes.map(({ position }) => position.y));
    const graphMaxY = Math.max(...result.nodes.map(({ position, size }) => position.y + size.height));
    const rootCenterY = (root?.position.y ?? 0) + (root?.size.height ?? 0) / 2;

    expect(Math.abs(rootCenterY - (graphMinY + graphMaxY) / 2)).toBeLessThanOrEqual((graphMaxY - graphMinY) / 4);
  });

  it("lays out left to right by default", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.x).toBeGreaterThan(source?.position.x ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "clamp", y: "center" });
  });

  it("accepts a direction per layout request", async () => {
    const options = { elk: { direction: "DOWN" } } as const;
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, options);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.y).toBeGreaterThan(source?.position.y ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "center", y: "clamp" });
  });

  it("marks edges for spline rendering when edgeRouting is SPLINES", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      elk: { direction: "RIGHT", "layered.edgeRouting": "SPLINES" },
    });

    expect(result.edges).toEqual([expect.objectContaining({ id: "source-target", routing: "spline" })]);
  });

  it("keeps polyline edges when edgeRouting is omitted or orthogonal", async () => {
    const defaults = await layoutGeneralDiagram(directionDiagram, directionNodeSizes);
    const orthogonal = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      elk: { "layered.edgeRouting": "ORTHOGONAL" },
    });

    expect(defaults.edges.at(0)).not.toHaveProperty("routing");
    expect(orthogonal.edges.at(0)).not.toHaveProperty("routing");
  });

  it("routes border-to-border bezier edges when bezierEdges is set", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      bezierEdges: true,
    });

    expect(result.edges).toEqual([
      expect.objectContaining({
        id: "source-target",
        routing: "bezier",
        points: [expect.any(Object), expect.any(Object)],
      }),
    ]);
  });

  it("composes nudged obstacles with bezier edges", async () => {
    const diagram = {
      ...diagramBase,
      nodes: [
        { nodeId: "source", type: "default", kind: "source", title: "Source" },
        { nodeId: "obstacle", type: "default", kind: "component", title: "Obstacle" },
        { nodeId: "target", type: "default", kind: "target", title: "Target" },
      ],
      edges: [
        { edgeId: "source-obstacle", type: "default", sourceNodeId: "source", targetNodeId: "obstacle" },
        { edgeId: "obstacle-target", type: "default", sourceNodeId: "obstacle", targetNodeId: "target" },
        { edgeId: "source-target", type: "default", sourceNodeId: "source", targetNodeId: "target" },
      ],
    } satisfies GeneralDiagramGraph;
    const nodeSizes = Object.fromEntries(diagram.nodes.map(({ nodeId }) => [nodeId, { width: 100, height: 100 }]));

    const result = await layoutGeneralDiagram(diagram, nodeSizes, {
      nudgeObstacleNodes: true,
      bezierEdges: true,
      elk: { direction: "DOWN" },
    });

    expect(result.edges.every(({ routing }) => routing === "bezier")).toBe(true);
    expect(result.edges.find(({ id }) => id === "source-target")?.points).toHaveLength(2);
  });

  it("resolves a raw direction alias like the verified option", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      elk: { "_.direction": "DOWN" },
    });
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.y).toBeGreaterThan(source?.position.y ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "center", y: "clamp" });
  });

  it("prefers the verified option when both forms are declared", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      elk: { "layered.edgeRouting": "SPLINES", "_.layered.edgeRouting": "ORTHOGONAL" },
    });

    expect(result.edges).toEqual([expect.objectContaining({ id: "source-target", routing: "spline" })]);
  });

  it("passes raw elk options through unverified", async () => {
    const result = await layoutGeneralDiagram(directionDiagram, directionNodeSizes, {
      elk: { "_.layered.thoroughness": "1" },
    });

    expect(result.edges.at(0)?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects elk option keys that are neither verified nor raw", () => {
    const parsed = generalDiagramLayoutConfigSchema.safeParse({
      layoutId: "general",
      options: { elk: { "layered.thoroughness": "9" } },
    });

    expect(parsed.error?.issues.at(0)?.message).toBe(
      "Unverified elk options must use the raw `_.` prefix with the full option id.",
    );
  });

  it("rejects raw padding and spacing options as design-owned", () => {
    for (const key of ["_.padding", "_.spacing.nodeNode", "_.layered.spacing.baseValue"]) {
      const parsed = generalDiagramLayoutConfigSchema.safeParse({
        layoutId: "general",
        options: { elk: { [key]: "40" } },
      });

      expect(parsed.error?.issues.at(0)?.message).toBe(
        "Padding and spacing options are design-owned and cannot be set.",
      );
    }
  });

  it("rejects non-string values for raw elk options", () => {
    const parsed = generalDiagramLayoutConfigSchema.safeParse({
      layoutId: "general",
      options: { elk: { "_.layered.thoroughness": 9 } },
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps the fitted viewport even when the graph has multiple roots", async () => {
    const diagram = {
      ...directionDiagram,
      edges: [],
    } satisfies GeneralDiagramGraph;

    const result = await layoutGeneralDiagram(diagram, directionNodeSizes);

    expect(result.initialView).toEqual({ mode: "fit" });
  });

  it("reserves header width for an empty group without overlapping its sibling", async () => {
    const diagram = {
      ...diagramBase,
      groups: [
        { type: "default", groupId: "empty", title: "Empty" },
        { type: "default", groupId: "sibling", title: "Sibling" },
      ],
      nodes: [{ nodeId: "solo", type: "default", kind: "source", title: "Solo", groupId: "sibling" }],
      edges: [],
    } satisfies GeneralDiagramGraph;

    const result = await layoutGeneralDiagram(diagram, { solo: { width: 100, height: 100 } });
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
    await expect(layoutGeneralDiagram(directionDiagram, { source: directionNodeSizes.source })).rejects.toThrow(
      "Missing measured node size: target",
    );
  });

  it("returns provider-agnostic placement and directed edge routes", async () => {
    const result = await layoutGeneralDiagram(groupedDiagram, groupedNodeSizes);

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
        { nodeId: "source", type: "default", kind: "source", title: "Source" },
        { nodeId: "obstacle", type: "default", kind: "component", title: "Obstacle" },
        { nodeId: "target", type: "default", kind: "target", title: "Target" },
      ],
      edges: [
        { edgeId: "source-obstacle", type: "default", sourceNodeId: "source", targetNodeId: "obstacle" },
        { edgeId: "obstacle-target", type: "default", sourceNodeId: "obstacle", targetNodeId: "target" },
        { edgeId: "source-target", type: "default", sourceNodeId: "source", targetNodeId: "target" },
      ],
    } satisfies GeneralDiagramGraph;
    const nodeSizes = Object.fromEntries(diagram.nodes.map(({ nodeId }) => [nodeId, { width: 100, height: 100 }]));

    const defaults = await layoutGeneralDiagram(diagram, nodeSizes, { elk: { direction: "DOWN" } });
    const nudged = await layoutGeneralDiagram(diagram, nodeSizes, {
      nudgeObstacleNodes: true,
      elk: { direction: "DOWN" },
    });

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

function toStraightenedGraph(
  edgeSpecs: ReadonlyArray<{ edgeId: string; sourceNodeId: string; targetNodeId: string }>,
): GeneralDiagramGraph {
  return {
    groups: [],
    nodes: [],
    edges: edgeSpecs.map((edge) => ({ ...edge, type: "default" })),
  } as unknown as GeneralDiagramGraph;
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
      toStraightenedGraph([{ edgeId: "source-target", sourceNodeId: "source", targetNodeId: "target" }]),
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
    const graph = toStraightenedGraph([{ edgeId: "source-target", sourceNodeId: "source", targetNodeId: "target" }]);
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
    const graph = toStraightenedGraph([{ edgeId: "source-target", sourceNodeId: "source", targetNodeId: "target" }]);
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
    const graph = toStraightenedGraph([{ edgeId: "source-target", sourceNodeId: "source", targetNodeId: "target" }]);
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
      toStraightenedGraph([{ edgeId: "source-target", sourceNodeId: "source", targetNodeId: "target" }]),
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
