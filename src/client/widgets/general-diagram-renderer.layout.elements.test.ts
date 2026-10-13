import { generalDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import { generalDiagramLayoutConfigSchema } from "@/features/diagram/diagram-layout";
import { toNodeRects } from "@/features/diagram/elk-core";

import { layoutGeneralDiagram } from "./general-diagram-renderer.layout";

const graph = generalDiagramGraphSchema.parse({
  groups: [
    { groupId: "outer", title: "Outer" },
    { groupId: "bounds", title: "Bounds", type: "bounding", parentGroupId: "outer", hideTitle: true },
  ],
  nodes: [
    { nodeId: "source", title: "Source", groupId: "bounds" },
    { nodeId: "diamond", title: "Ready?", type: "diamond", groupId: "bounds" },
    { nodeId: "target", title: "Target", groupId: "bounds" },
  ],
  edges: [
    { edgeId: "in", sourceNodeId: "source", targetNodeId: "diamond" },
    { edgeId: "out", sourceNodeId: "diamond", targetNodeId: "target" },
  ],
});
const sizes = {
  source: { width: 288, height: 144 },
  diamond: { width: 160, height: 112 },
  target: { width: 288, height: 144 },
};

describe("general authored elements", () => {
  test.each(["RIGHT", "LEFT", "UP", "DOWN"])(
    "anchors nested diamond edges on the outline flowing %s",
    async (direction) => {
      for (const routing of [{}, { bezierEdges: true }, { nudgeObstacleNodes: true }]) {
        const options = generalDiagramLayoutConfigSchema.parse({
          layoutId: "general",
          options: { ...routing, elk: { direction } },
        }).options;
        const layout = await layoutGeneralDiagram(graph, sizes, options);
        const diamond = toNodeRects(layout.nodes, layout.groups).get("diamond")!;
        const center = { x: (diamond.min.x + diamond.max.x) / 2, y: (diamond.min.y + diamond.max.y) / 2 };
        const endpoints = [
          layout.edges.find(({ id }) => id === "in")!.points.at(-1)!,
          layout.edges.find(({ id }) => id === "out")!.points.at(0)!,
        ];
        for (const point of endpoints) {
          expect(
            Math.abs(point.x - center.x) / ((160 * 22) / 48) + Math.abs(point.y - center.y) / ((112 * 22) / 48),
          ).toBeCloseTo(1);
        }
        expect(layout.groups.find(({ id }) => id === "bounds")?.parentId).toBe("outer");
      }
    },
  );

  test("keeps a diamond self-loop route nondegenerate with optional straightening", async () => {
    const loopGraph = generalDiagramGraphSchema.parse({
      nodes: [{ nodeId: "diamond", type: "diamond", title: "Repeat?" }],
      groups: [],
      edges: [{ edgeId: "loop", sourceNodeId: "diamond", targetNodeId: "diamond" }],
    });
    for (const routing of [{}, { bezierEdges: true }, { nudgeObstacleNodes: true }]) {
      const options = generalDiagramLayoutConfigSchema.parse({ layoutId: "general", options: routing }).options;
      const layout = await layoutGeneralDiagram(loopGraph, sizes, options);
      const points = layout.edges.at(0)!.points;
      expect(points.length).toBeGreaterThan(2);
      expect(points.some((point) => point.x !== points.at(0)!.x || point.y !== points.at(0)!.y)).toBe(true);
    }
  });
});
