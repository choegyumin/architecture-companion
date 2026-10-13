import type { DiagramReactFlowRenderModel } from "@/client/parts/diagram-view.react-flow";
import { applyWalkthrough } from "@/client/parts/diagram-view.walkthrough";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const model: DiagramReactFlowRenderModel = {
  nodes: [
    { id: "group", type: "labeled-group", position: { x: 10, y: 20 }, data: { label: "Group" } },
    {
      id: "one",
      type: "rectangle",
      position: { x: 20, y: 30 },
      parentId: "group",
      data: { label: "One" },
      className: "opacity-50",
    },
    { id: "two", type: "rectangle", position: { x: 300, y: 0 }, data: { label: "Two" } },
    { id: "outline", type: "bounding-group", position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    {
      id: "render-edge",
      type: "connection",
      source: "one",
      target: "two",
      data: { path: "M 30 50 L 300 50", labelPosition: { x: 165, y: 50 } },
      style: { opacity: 0.1 },
      markerEnd: { type: "arrowclosed", color: "gray" },
    },
    { id: "other", type: "connection", source: "group", target: "two" },
  ],
  graphEdgeIds: new Map([
    ["render-edge", ["stored-edge"]],
    ["other", []],
  ]),
};
const layout: DiagramLayout = {
  groups: [{ id: "group", position: { x: 10, y: 20 }, size: { width: 200, height: 200 } }],
  nodes: [
    { id: "one", parentId: "group", position: { x: 20, y: 30 }, size: { width: 100, height: 80 } },
    { id: "two", position: { x: 300, y: 0 }, size: { width: 100, height: 80 } },
  ],
  edges: [
    {
      id: "render-edge",
      points: [
        { x: 30, y: 50 },
        { x: 300, y: 50 },
      ],
    },
  ],
  initialView: { mode: "fit" },
};

describe("Walkthrough diagram presentation", () => {
  it("keeps an explanation-only step unchanged, with no camera target", () => {
    const result = applyWalkthrough(model, [], layout);
    expect(result.model).toBe(model);
    expect(result.frame).toBeUndefined();
  });

  it("emphasizes only selected node/group elements and leaves derived decoration alone", () => {
    const result = applyWalkthrough(
      model,
      [
        { type: "node", id: "one" },
        { type: "group", id: "group" },
      ],
      layout,
    );
    expect(result.model.nodes.at(0)).toMatchObject({ className: "is-walkthrough-emphasis", zIndex: 5 });
    expect(result.model.nodes.at(1)).toMatchObject({
      className: "opacity-50 is-walkthrough-emphasis",
      style: { opacity: 1 },
      zIndex: 5,
    });
    expect(result.model.nodes.at(2)).toMatchObject({ className: "is-walkthrough-dim" });
    expect(result.model.nodes.at(3)).toBe(model.nodes.at(3));
    expect(result.frame).toEqual({ mode: "nodes", nodeIds: ["one", "group"] });
  });

  it("matches stored edge IDs through projection provenance, overrides system dimming, and frames endpoints", () => {
    const result = applyWalkthrough(model, [{ type: "edge", id: "stored-edge" }], layout);
    expect(result.model.edges.at(0)).toMatchObject({
      style: { opacity: 1, stroke: "var(--primary)", strokeWidth: 3 },
      markerEnd: { type: "arrowclosed", color: "var(--primary)" },
    });
    expect(result.model.edges.at(1)).toMatchObject({ style: { opacity: 0.25 } });
    expect(result.frame).toEqual({ mode: "nodes", nodeIds: ["one", "two"] });
    expect(model.edges.at(0)?.style?.opacity).toBe(0.1);
  });

  it("matches bundled dependency edges through their underlying edge-set", () => {
    const bundled = {
      ...model,
      graphEdgeIds: undefined,
      edgeTargets: new Map([
        [
          "render-edge",
          { type: "edge-set" as const, sourceId: "group", targetId: "two", edgeIds: ["saved-one", "saved-two"] },
        ],
      ]),
    };
    const result = applyWalkthrough(
      bundled,
      [{ type: "edge-set", sourceId: "group", targetId: "two", edgeIds: ["saved-two"] }],
      layout,
    );
    expect(result.model.edges.at(0)?.style?.opacity).toBe(1);
    expect(result.frame).toEqual({ mode: "nodes", nodeIds: ["group", "two", "one"] });
  });

  it("does not mistake a synthetic edge ID with empty provenance for a stored edge", () => {
    const result = applyWalkthrough(model, [{ type: "edge", id: "other" }], layout);
    expect(result.model.edges.at(1)?.style?.opacity).toBe(0.25);
    expect(result.frame).toBeUndefined();
  });

  it("frames sequence message geometry rather than the entire lifelines", () => {
    const sequence: DiagramReactFlowRenderModel = {
      nodes: [
        { id: "one", type: "lifeline", position: { x: 0, y: 0 }, data: { node: { kind: "service", title: "One" } } },
        { id: "two", type: "lifeline", position: { x: 300, y: 0 }, data: { node: { kind: "service", title: "Two" } } },
      ],
      edges: [{ id: "render-edge", type: "connection", source: "one", target: "two" }],
    };
    const result = applyWalkthrough(sequence, [{ type: "edge", id: "render-edge" }], layout);
    expect(result.frame).toEqual({ mode: "bounds", bounds: { x: 30, y: 50, width: 270, height: 48 } });
  });
});
