import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import type { DiagramReactFlowRenderModel } from "@/client/widgets/diagram-renderer.react-flow";
import {
  applySpotlight,
  computeSpotlightFrame,
  SPOTLIGHT_DIMMED_CLASS_NAME,
  SPOTLIGHT_EMPHASIZED_CLASS_NAME,
} from "@/client/widgets/diagram-spotlight";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
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

function lifelineNode(id: string): DiagramReactFlowNode {
  return {
    id,
    type: "lifeline",
    position: { x: 0, y: 0 },
    data: { node: { kind: "actor", title: id } },
    selectable: false,
  };
}

function fragmentNode(id: string): DiagramReactFlowNode {
  return {
    id,
    type: "fragment",
    position: { x: 0, y: 0 },
    data: { node: { operator: "alt", branches: [] } },
    selectable: false,
  };
}

describe("computeSpotlightFrame", () => {
  const sequenceLayout: DiagramLayout = {
    nodes: [
      { id: "user", position: { x: 40, y: 0 }, size: { width: 120, height: 2000 } },
      { id: "server", position: { x: 400, y: 0 }, size: { width: 120, height: 2000 } },
      { id: "retry", position: { x: 80, y: 300 }, size: { width: 320, height: 240 } },
    ],
    groups: [],
    edges: [
      {
        id: "m1",
        points: [
          { x: 100, y: 400 },
          { x: 460, y: 400 },
        ],
      },
      {
        id: "m2",
        points: [
          { x: 460, y: 500 },
          { x: 100, y: 500 },
        ],
      },
    ],
    initialView: { mode: "fit" },
  };

  it("frames regular diagram nodes through fitView", () => {
    const target = computeSpotlightFrame(
      model([cardNode("cart"), cardNode("pay")]),
      sequenceLayout,
      ["cart", "pay"],
      [],
    );

    expect(target).toEqual({ kind: "nodes", nodeIds: ["cart", "pay"] });
  });

  it("frames sequence message geometry as bounds so the viewport can zoom", () => {
    const target = computeSpotlightFrame(
      model([lifelineNode("user"), lifelineNode("server")]),
      sequenceLayout,
      ["user", "server"],
      ["m1"],
    );

    // The lifeline columns keep the actor headers in view alongside the message.
    expect(target).toEqual({ kind: "bounds", x: 40, y: 400, width: 480, height: 48 });
  });

  it("unions several messages and keeps real height for stacked ones", () => {
    const target = computeSpotlightFrame(
      model([lifelineNode("user"), lifelineNode("server")]),
      sequenceLayout,
      ["user", "server"],
      ["m1", "m2"],
    );

    expect(target).toEqual({ kind: "bounds", x: 40, y: 400, width: 480, height: 100 });
  });

  it("includes fragment rectangles and lifeline columns without lifeline height", () => {
    const target = computeSpotlightFrame(
      model([lifelineNode("user"), fragmentNode("retry")]),
      sequenceLayout,
      ["user", "retry"],
      [],
    );

    expect(target).toEqual({ kind: "bounds", x: 40, y: 300, width: 360, height: 240 });
  });

  it("falls back to node framing for a lifeline-only step", () => {
    const target = computeSpotlightFrame(model([lifelineNode("user")]), sequenceLayout, ["user"], []);

    expect(target).toEqual({ kind: "nodes", nodeIds: ["user"] });
  });
});
