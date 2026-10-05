import {
  elkLayeredDiagramLayoutConfigSchema,
  layoutElkLayeredDiagram,
  straightenLayeredEdges,
} from "@/features/diagram/_layout/elk-layered-diagram-layout";
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
    const graphMinY = Math.min(...result.nodes.map(({ position }) => position.y));
    const graphMaxY = Math.max(...result.nodes.map(({ position, size }) => position.y + size.height));
    const rootCenterY = (root?.position.y ?? 0) + (root?.size.height ?? 0) / 2;

    expect(Math.abs(rootCenterY - (graphMinY + graphMaxY) / 2)).toBeLessThanOrEqual((graphMaxY - graphMinY) / 4);
  });

  it("lays out left to right by default", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.x).toBeGreaterThan(source?.position.x ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "clamp", y: "center" });
  });

  it("accepts a direction per layout request", async () => {
    const options = { elk: { direction: "DOWN" } } as const;
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, options);
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.y).toBeGreaterThan(source?.position.y ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "center", y: "clamp" });
  });

  it("marks edges for spline rendering when edgeRouting is SPLINES", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      elk: { direction: "RIGHT", "layered.edgeRouting": "SPLINES" },
    });

    expect(result.edges).toEqual([expect.objectContaining({ id: "source-target", routing: "spline" })]);
  });

  it("keeps polyline edges when edgeRouting is omitted or orthogonal", async () => {
    const defaults = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes);
    const orthogonal = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      elk: { "layered.edgeRouting": "ORTHOGONAL" },
    });

    expect(defaults.edges.at(0)).not.toHaveProperty("routing");
    expect(orthogonal.edges.at(0)).not.toHaveProperty("routing");
  });

  it("routes border-to-border bezier edges when bezierEdges is set", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
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

    const result = await layoutElkLayeredDiagram(diagram, nodeSizes, {
      nudgeObstacleNodes: true,
      bezierEdges: true,
      elk: { direction: "DOWN" },
    });

    expect(result.edges.every(({ routing }) => routing === "bezier")).toBe(true);
    expect(result.edges.find(({ id }) => id === "source-target")?.points).toHaveLength(2);
  });

  it("resolves a raw direction alias like the verified option", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      elk: { "_.direction": "DOWN" },
    });
    const source = result.nodes.find(({ id }) => id === "source");
    const target = result.nodes.find(({ id }) => id === "target");

    expect(target?.position.y).toBeGreaterThan(source?.position.y ?? Number.POSITIVE_INFINITY);
    expect(result.initialView).toEqual({ mode: "node", nodeId: "source", x: "center", y: "clamp" });
  });

  it("prefers the verified option when both forms are declared", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      elk: { "layered.edgeRouting": "SPLINES", "_.layered.edgeRouting": "ORTHOGONAL" },
    });

    expect(result.edges).toEqual([expect.objectContaining({ id: "source-target", routing: "spline" })]);
  });

  it("passes raw elk options through unverified", async () => {
    const result = await layoutElkLayeredDiagram(directionDiagram, directionNodeSizes, {
      elk: { "_.layered.thoroughness": "1" },
    });

    expect(result.edges.at(0)?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects elk option keys that are neither verified nor raw", () => {
    const parsed = elkLayeredDiagramLayoutConfigSchema.safeParse({
      id: "elk-layered",
      options: { elk: { "layered.thoroughness": "9" } },
    });

    expect(parsed.error?.issues.at(0)?.message).toBe(
      "Unverified elk options must use the raw `_.` prefix with the full option id.",
    );
  });

  it("rejects raw padding and spacing options as design-owned", () => {
    for (const key of ["_.padding", "_.spacing.nodeNode", "_.layered.spacing.baseValue"]) {
      const parsed = elkLayeredDiagramLayoutConfigSchema.safeParse({
        id: "elk-layered",
        options: { elk: { [key]: "40" } },
      });

      expect(parsed.error?.issues.at(0)?.message).toBe(
        "Padding and spacing options are design-owned and cannot be set.",
      );
    }
  });

  it("rejects non-string values for raw elk options", () => {
    const parsed = elkLayeredDiagramLayoutConfigSchema.safeParse({
      id: "elk-layered",
      options: { elk: { "_.layered.thoroughness": 9 } },
    });

    expect(parsed.success).toBe(false);
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

  it("orders decision ports by case and starts each arm at its port", async () => {
    const diagram = {
      ...diagramBase,
      nodes: [
        { id: "app", type: "default", kind: "component", title: "App" },
        { id: "mode", type: "decision", title: "mode" },
        { id: "first-target", type: "default", kind: "component", title: "First target" },
        { id: "second-target", type: "default", kind: "component", title: "Second target" },
      ],
      edges: [
        { id: "entry", type: "default", source: "app", target: "mode" },
        { id: "arm-first", type: "default", source: "mode", target: "first-target", sourcePort: "first" },
        { id: "arm-second", type: "default", source: "mode", target: "second-target", sourcePort: "second" },
      ],
      controls: [
        {
          id: "mode",
          owner: "app",
          kind: "branch",
          label: "mode",
          dependsOn: [[]],
          cases: [
            { id: "first", label: "First" },
            { id: "second", label: "Second" },
          ],
        },
      ],
    } satisfies DiagramGraph;
    const nodeSizes = Object.fromEntries(
      diagram.nodes.map(({ id, type }) => [
        id,
        type === "decision" ? { width: 48, height: 48 } : { width: 288, height: 144 },
      ]),
    );

    const result = await layoutElkLayeredDiagram(diagram, nodeSizes);
    const decision = result.nodes.find(({ id }) => id === "mode");
    const firstStart = result.edges.find(({ id }) => id === "arm-first")?.points.at(0);
    const secondStart = result.edges.find(({ id }) => id === "arm-second")?.points.at(0);
    if (!decision || !firstStart || !secondStart) throw new Error("Layout lost the decision arms.");

    // Rightward flow: the arms leave the diamond's right vertex edges in case
    // order, top to bottom, anchored on the drawn outline.
    expect(firstStart.y).toBeLessThan(secondStart.y);
    for (const start of [firstStart, secondStart]) {
      expect(start.x).toBeGreaterThanOrEqual(decision.position.x + decision.size.width / 2 - 4);
      expect(start.x).toBeLessThanOrEqual(decision.position.x + decision.size.width + 4);
      expect(start.y).toBeGreaterThan(decision.position.y);
      expect(start.y).toBeLessThan(decision.position.y + decision.size.height);
    }
  });

  it("binds every decision arm to its own node's downstream port even when case ids collide", async () => {
    const branch = (id: string, owner: string) => ({
      id,
      owner,
      kind: "branch" as const,
      label: id,
      dependsOn: [[]],
      cases: [
        { id: "true", label: "True" },
        { id: "false", label: "False" },
      ],
    });
    const diagram = {
      ...diagramBase,
      nodes: [
        { id: "app", type: "default", kind: "component", title: "App" },
        { id: "first-mode", type: "decision", title: "First mode" },
        { id: "second-mode", type: "decision", title: "Second mode" },
        { id: "first-empty", type: "default", kind: "component", title: "First empty" },
        { id: "second-empty", type: "default", kind: "component", title: "Second empty" },
      ],
      edges: [
        { id: "entry-first", type: "default", source: "app", target: "first-mode" },
        { id: "entry-second", type: "default", source: "app", target: "second-mode" },
        { id: "arm-first-true", type: "default", source: "first-mode", target: "first-empty", sourcePort: "true" },
        { id: "arm-first-false", type: "default", source: "first-mode", target: "first-empty", sourcePort: "false" },
        { id: "arm-second-true", type: "default", source: "second-mode", target: "second-empty", sourcePort: "true" },
        { id: "arm-second-false", type: "default", source: "second-mode", target: "second-empty", sourcePort: "false" },
      ],
      controls: [branch("first-mode", "app"), branch("second-mode", "app")],
    } satisfies DiagramGraph;
    const nodeSizes = Object.fromEntries(
      diagram.nodes.map(({ id, type }) => [
        id,
        type === "decision" ? { width: 48, height: 48 } : { width: 288, height: 144 },
      ]),
    );

    // The artifact pipeline: downward flow with obstacle nudging enabled.
    const result = await layoutElkLayeredDiagram(diagram, nodeSizes, {
      nudgeObstacleNodes: true,
      elk: { direction: "DOWN" },
    });

    for (const decisionId of ["first-mode", "second-mode"]) {
      const decision = result.nodes.find(({ id }) => id === decisionId);
      if (!decision) throw new Error(`Layout lost ${decisionId}.`);
      const starts = diagram.edges
        .filter((edge) => edge.type === "default" && edge.source === decisionId && edge.sourcePort)
        .map((edge) => {
          const start = result.edges.find(({ id }) => id === edge.id)?.points.at(0);
          if (!start) throw new Error(`Layout lost ${edge.id}.`);
          return { port: edge.sourcePort, start };
        })
        .toSorted((left, right) => left.start.x - right.start.x);

      // Downward flow: every arm leaves its own diamond's lower vertex edges,
      // in case order left to right.
      for (const { start } of starts) {
        expect(start.y).toBeGreaterThanOrEqual(decision.position.y + decision.size.height / 2 - 4);
        expect(start.y).toBeLessThanOrEqual(decision.position.y + decision.size.height + 4);
        expect(start.x).toBeGreaterThan(decision.position.x);
        expect(start.x).toBeLessThan(decision.position.x + decision.size.width);
      }
      expect(starts.map(({ port }) => port)).toEqual(["true", "false"]);
    }
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

    const defaults = await layoutElkLayeredDiagram(diagram, nodeSizes, { elk: { direction: "DOWN" } });
    const nudged = await layoutElkLayeredDiagram(diagram, nodeSizes, {
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
