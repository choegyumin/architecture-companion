import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import type { DiagramReactFlowRenderModel } from "@/client/widgets/diagram-renderer.react-flow";
import {
  applySpotlight,
  SPOTLIGHT_DIMMED_CLASS_NAME,
  SPOTLIGHT_EMPHASIZED_CLASS_NAME,
} from "@/client/widgets/diagram-spotlight";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";

function cardNode(id: string): DiagramReactFlowNode {
  return { id, type: "card", position: { x: 0, y: 0 }, data: { label: id }, selectable: false };
}

function routeEdge(id: string, source: string, target: string): DiagramReactFlowEdge {
  return {
    id,
    source,
    target,
    type: "route",
    selectable: false,
    style: { stroke: "var(--diagram-edge)", strokeWidth: 2 },
    data: { path: "M 0 0 L 1 1", labelPosition: { x: 0, y: 0 } },
  };
}

function model(
  nodes: readonly DiagramReactFlowNode[],
  edges: readonly DiagramReactFlowEdge[] = [],
  edgeTargets?: ReadonlyMap<string, AnnotationTarget>,
): DiagramReactFlowRenderModel {
  return { nodes: [...nodes], edges: [...edges], ...(edgeTargets ? { edgeTargets } : {}) };
}

function spotlight(steps: ArtifactSpotlight["diagram"]["steps"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram: { steps } };
}

describe("applySpotlight", () => {
  it("emphasizes the current step's nodes and edges and dims the rest", () => {
    const result = applySpotlight(
      model([cardNode("cart"), cardNode("pay")], [routeEdge("e1", "cart", "pay")]),
      spotlight([
        { elements: [{ type: "node", id: "pay" }] },
        {
          elements: [
            { type: "node", id: "cart" },
            { type: "edge", id: "e1" },
          ],
          caption: "Cart pays",
        },
      ]),
      1,
    );

    expect(result.framedNodeIds).toEqual(["cart", "pay"]);
    expect(result.framedEdgeIds).toEqual(["e1"]);
    expect(result.model.nodes.map(({ id, className }) => [id, className])).toEqual([
      ["cart", SPOTLIGHT_EMPHASIZED_CLASS_NAME],
      ["pay", SPOTLIGHT_DIMMED_CLASS_NAME],
    ]);
    const edge = result.model.edges.at(0);
    expect(edge?.className).toBe(SPOTLIGHT_EMPHASIZED_CLASS_NAME);
    expect(edge?.style).toMatchObject({ stroke: "var(--primary)", strokeWidth: 3 });
  });

  it("emphasizes only the addressed step", () => {
    const result = applySpotlight(
      model([cardNode("cart"), cardNode("pay")], [routeEdge("e1", "cart", "pay")]),
      spotlight([{ elements: [{ type: "node", id: "pay" }] }, { elements: [{ type: "edge", id: "e1" }] }]),
      0,
    );

    expect(result.framedEdgeIds).toEqual([]);
    expect(result.model.nodes.map(({ id, className }) => [id, className])).toEqual([
      ["cart", SPOTLIGHT_DIMMED_CLASS_NAME],
      ["pay", SPOTLIGHT_EMPHASIZED_CLASS_NAME],
    ]);
    expect(result.model.edges.at(0)?.className).toBe(SPOTLIGHT_DIMMED_CLASS_NAME);
  });

  it("emphasizes an aggregate render edge through its edge-set target", () => {
    const edgeTargets = new Map<string, AnnotationTarget>([
      ["agg-1", { type: "edge-set", sourceId: "cart", targetId: "pay", edgeIds: ["e1", "e2"] }],
    ]);
    const result = applySpotlight(
      model([cardNode("cart"), cardNode("pay")], [routeEdge("agg-1", "cart", "pay")], edgeTargets),
      spotlight([{ elements: [{ type: "edge-set", sourceId: "cart", targetId: "pay", edgeIds: ["e2"] }] }]),
      0,
    );

    expect(result.model.edges.at(0)?.className).toBe(SPOTLIGHT_EMPHASIZED_CLASS_NAME);
    expect(result.framedNodeIds).toEqual(["cart", "pay"]);
    expect(result.framedEdgeIds).toEqual(["e2"]);
  });

  it("frames group targets and leaves bounding-group decoration untouched", () => {
    const boundingGroup: DiagramReactFlowNode = {
      id: "bundle-1",
      type: "bounding-group",
      position: { x: 0, y: 0 },
      data: {},
      parentId: "store",
      selectable: false,
    };
    const groupNode: DiagramReactFlowNode = {
      id: "store",
      type: "labeled-group",
      position: { x: 0, y: 0 },
      data: { label: "Store" },
      selectable: false,
    };
    const result = applySpotlight(
      model([groupNode, boundingGroup, cardNode("cart")]),
      spotlight([{ elements: [{ type: "group", id: "store" }] }]),
      0,
    );

    expect(result.framedNodeIds).toEqual(["store"]);
    expect(result.model.nodes.map(({ id, className }) => [id, className])).toEqual([
      ["store", SPOTLIGHT_EMPHASIZED_CLASS_NAME],
      ["bundle-1", undefined],
      ["cart", SPOTLIGHT_DIMMED_CLASS_NAME],
    ]);
  });

  it("returns the unchanged model for a whole-artifact step or unknown elements", () => {
    const whole = model([cardNode("cart")], [routeEdge("e1", "cart", "cart")]);

    expect(applySpotlight(whole, spotlight([{ elements: [] }]), 0)).toEqual({
      model: whole,
      framedNodeIds: [],
      framedEdgeIds: [],
    });
    expect(applySpotlight(whole, spotlight([{ elements: [{ type: "node", id: "ghost" }] }]), 0)).toEqual({
      model: whole,
      framedNodeIds: [],
      framedEdgeIds: [],
    });
  });
});
