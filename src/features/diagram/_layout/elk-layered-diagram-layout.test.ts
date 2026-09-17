import { layoutElkLayeredDiagram } from "@/features/diagram/_layout/elk-layered-diagram-layout";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";

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
});
