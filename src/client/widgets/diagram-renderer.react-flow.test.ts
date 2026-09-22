import { MarkerType } from "@xyflow/react";

import {
  buildDiagramMeasurementNodes,
  buildDiagramReactFlowEdges,
  buildDiagramReactFlowRenderModel,
  resolveDiagramNodeSizes,
} from "@/client/widgets/diagram-renderer.react-flow";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const sequenceDiagram = {
  id: "sequence",
  title: "Sequence",
  generator: "built-in:freeform",
  layout: { id: "sequence" },
  graph: {
    groups: [],
    nodes: [
      {
        id: "participant",
        type: "lifeline",
        kind: "participant",
        title: "Participant",
        links: [{ href: "source:///src/participant.ts" }],
        activations: [],
      },
    ],
    edges: [],
  },
} satisfies Diagram;

describe("diagram renderer React Flow adapter", () => {
  it("converts default artifact elements to the generic React Flow contract", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        ...sequenceDiagram.graph,
        groups: [{ id: "group", title: "Group", description: "Boundary" }],
        nodes: [
          {
            id: "step",
            type: "default",
            kind: "action",
            title: "Review",
            description: "Inspect the change",
            details: ["Read the diff"],
            groupId: "group",
            links: [{ href: "source:///src/review.ts", text: "Review source" }],
          },
        ],
        edges: [
          {
            id: "next",
            type: "default",
            source: "step",
            target: "step",
            kind: "result",
            label: "Continue",
            href: "https://example.com/review",
          },
        ],
      },
    } satisfies Diagram;
    const layout = {
      groups: [
        {
          id: "group",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
        },
      ],
      nodes: [
        {
          id: "step",
          parentId: "group",
          position: { x: 40, y: 60 },
          size: { width: 288, height: 144 },
        },
      ],
      edges: [
        {
          id: "next",
          points: [
            { x: 100, y: 100 },
            { x: 200, y: 160 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const [measurementNode] = buildDiagramMeasurementNodes(diagram, vi.fn());
    const { nodes, edges } = buildDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(measurementNode).toMatchObject({
      type: "card",
      data: {
        label: "Review",
        eyebrow: "action",
        description: "Inspect the change",
        details: ["Read the diff"],
        links: [{ href: "source:///src/review.ts" }],
      },
    });
    expect(nodes.at(0)).toMatchObject({
      id: "group",
      type: "labeled-group",
      position: { x: 0, y: 0 },
      data: { label: "Group", description: "Boundary" },
    });
    expect(edges.at(0)).toMatchObject({
      id: "next",
      source: "step",
      target: "step",
      type: "polyline",
      label: "Continue",
      data: {
        points: layout.edges.at(0)?.points,
        eyebrow: "result",
        href: "https://example.com/review",
      },
    });
  });

  it("renders top-level dependency aggregates for the grouped row layout", () => {
    const diagram = {
      ...sequenceDiagram,
      layout: { id: "prototype-group-rows" },
      graph: {
        groups: [
          { id: "source-group", title: "Source" },
          { id: "target-group", title: "Target" },
        ],
        nodes: [
          { id: "source", type: "default", title: "Source", groupId: "source-group" },
          { id: "target", type: "default", title: "Target", groupId: "target-group" },
        ],
        edges: [
          { id: "first", type: "default", source: "source", target: "target" },
          { id: "second", type: "default", source: "source", target: "target" },
        ],
      },
    } satisfies Diagram;
    const layout = {
      groups: [
        { id: "source-group", position: { x: 0, y: 0 }, size: { width: 400, height: 300 } },
        { id: "target-group", position: { x: 0, y: 500 }, size: { width: 400, height: 300 } },
      ],
      nodes: [
        {
          id: "source",
          parentId: "source-group",
          position: { x: 40, y: 60 },
          size: { width: 288, height: 144 },
        },
        {
          id: "target",
          parentId: "target-group",
          position: { x: 40, y: 60 },
          size: { width: 288, height: 144 },
        },
      ],
      edges: [
        {
          id: "first",
          points: [
            { x: 328, y: 132 },
            { x: 40, y: 632 },
          ],
        },
        {
          id: "second",
          points: [
            { x: 328, y: 132 },
            { x: 40, y: 632 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const edges = buildDiagramReactFlowEdges(diagram, layout, vi.fn());

    expect(edges).toHaveLength(1);
    expect(edges.at(0)).toMatchObject({
      id: "aggregate:source-group->target-group",
      source: "source-group",
      target: "target-group",
      type: "polyline",
      label: "×2",
      data: { points: expect.any(Array) },
    });
  });

  it("omits the card eyebrow when a default node has no kind", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        groups: [],
        nodes: [{ id: "component", type: "default", title: "Component" }],
        edges: [],
      },
    } satisfies Diagram;

    const [measurementNode] = buildDiagramMeasurementNodes(diagram, vi.fn());

    expect(measurementNode?.data).toMatchObject({ label: "Component" });
    expect(measurementNode?.data).not.toHaveProperty("eyebrow");
  });

  it("keeps direct render edges unlabeled", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        groups: [],
        nodes: [
          { id: "parent", type: "default", kind: "React component", title: "Parent", links: [] },
          { id: "child", type: "default", kind: "React component", title: "Child", links: [] },
        ],
        edges: [
          {
            id: "render",
            type: "default",
            source: "parent",
            target: "child",
            kind: "direct-render",
          },
        ],
      },
    } satisfies Diagram;
    const layout = {
      groups: [],
      nodes: [
        { id: "parent", position: { x: 0, y: 0 }, size: { width: 288, height: 144 } },
        { id: "child", position: { x: 0, y: 240 }, size: { width: 288, height: 144 } },
      ],
      edges: [
        {
          id: "render",
          points: [
            { x: 144, y: 144 },
            { x: 144, y: 240 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const { edges } = buildDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.at(0)).not.toHaveProperty("label");
    expect(edges.at(0)?.data).not.toHaveProperty("eyebrow");
  });

  it("preserves case-sensitive prop names in relationship kinds", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        groups: [],
        nodes: [
          { id: "renderer", type: "default", kind: "React component", title: "Renderer" },
          { id: "content", type: "default", kind: "React component", title: "Content" },
        ],
        edges: [
          {
            id: "render",
            type: "default",
            source: "renderer",
            target: "content",
            kind: "RENDER (fooBar)",
            label: "from App",
          },
        ],
      },
    } satisfies Diagram;
    const layout = {
      groups: [],
      nodes: [
        { id: "renderer", position: { x: 0, y: 0 }, size: { width: 288, height: 144 } },
        { id: "content", position: { x: 400, y: 0 }, size: { width: 288, height: 144 } },
      ],
      edges: [
        {
          id: "render",
          points: [
            { x: 288, y: 72 },
            { x: 400, y: 72 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const { edges } = buildDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.at(0)).toMatchObject({
      label: "from App",
      data: { eyebrow: "RENDER (fooBar)" },
    });
  });

  it("lets lifeline content determine the measured height", () => {
    const [lifeline] = buildDiagramMeasurementNodes(sequenceDiagram, vi.fn());

    expect(lifeline?.style?.width).toEqual(expect.any(Number));
    expect(lifeline?.style).not.toHaveProperty("height");
  });

  it("uses measured React Flow node sizes when available", () => {
    const [lifeline] = buildDiagramMeasurementNodes(sequenceDiagram, vi.fn());
    if (!lifeline) throw new Error("Expected a measurement node.");

    expect(resolveDiagramNodeSizes(sequenceDiagram, [{ ...lifeline, measured: { height: 320, width: 240 } }])).toEqual({
      participant: { height: 320, width: 240 },
    });
  });

  it("uses renderer sizes for node types that are not measured", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        ...sequenceDiagram.graph,
        nodes: [
          { id: "default", type: "default", kind: "step", title: "Default" },
          { id: "lifeline", type: "lifeline", kind: "participant", title: "Lifeline", activations: [] },
          {
            id: "fragment",
            type: "fragment",
            kind: "phase",
            title: "Fragment",
            operator: "opt",
            branches: [],
          },
        ],
      },
    } satisfies Diagram;
    const nodes = buildDiagramMeasurementNodes(diagram, vi.fn());

    expect(resolveDiagramNodeSizes(diagram, nodes)).toEqual({
      default: { height: 144, width: 288 },
      lifeline: { height: 160, width: 224 },
      fragment: { height: 160, width: 448 },
    });
  });

  it("rejects a diagram node without a React Flow measurement node", () => {
    expect(() => resolveDiagramNodeSizes(sequenceDiagram, [])).toThrow(
      "React Flow did not measure diagram node: participant",
    );
  });

  it("renders sequence message direction and type with UML edge notation", () => {
    const diagram = {
      ...sequenceDiagram,
      graph: {
        ...sequenceDiagram.graph,
        nodes: [
          {
            id: "client",
            type: "lifeline",
            kind: "participant",
            title: "Client",
            links: [],
            activations: [],
          },
          {
            id: "server",
            type: "lifeline",
            kind: "participant",
            title: "Server",
            links: [],
            activations: [],
          },
        ],
        edges: [
          { id: "sync", type: "message", source: "client", target: "server", messageType: "sync" },
          { id: "async", type: "message", source: "client", target: "server", messageType: "async" },
          { id: "return", type: "message", source: "server", target: "client", messageType: "return" },
        ],
      },
    } satisfies Diagram;
    const layout = {
      nodes: diagram.graph.nodes.map(({ id }, index) => ({
        id,
        position: { x: index * 300, y: 0 },
        size: { width: 224, height: 400 },
      })),
      groups: [],
      edges: diagram.graph.edges.map(({ id }, index) => ({
        id,
        points: [
          { x: 112, y: 200 + index * 72 },
          { x: 412, y: 200 + index * 72 },
        ],
      })),
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const { edges } = buildDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.map(({ markerEnd }) => markerEnd)).toEqual([
      expect.objectContaining({ type: MarkerType.ArrowClosed }),
      expect.objectContaining({ type: MarkerType.Arrow }),
      expect.objectContaining({ type: MarkerType.Arrow }),
    ]);
    expect(edges.map(({ style }) => style?.strokeDasharray)).toEqual([undefined, undefined, "6 4"]);
    expect(edges.map(({ type, sourceHandle, targetHandle }) => ({ type, sourceHandle, targetHandle }))).toEqual([
      { type: "message", sourceHandle: "sync:source", targetHandle: "sync:target" },
      { type: "message", sourceHandle: "async:source", targetHandle: "async:target" },
      { type: "message", sourceHandle: "return:source", targetHandle: "return:target" },
    ]);
    edges.forEach(({ data }) => {
      expect(data).toHaveProperty("onLinkActivate", expect.any(Function));
    });
  });

  it("rejects a group missing from the layout result", () => {
    const layout = {
      groups: [{ id: "missing-group", position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
      nodes: [],
      edges: [],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    expect(() => buildDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
      "Layout result references an unknown diagram group: missing-group",
    );
  });

  it("rejects a node missing from the layout result", () => {
    const layout = {
      groups: [],
      nodes: [{ id: "missing-node", position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
      edges: [],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    expect(() => buildDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
      "Layout result references an unknown diagram node: missing-node",
    );
  });

  it("rejects an edge missing from the layout result", () => {
    const layout = {
      groups: [],
      nodes: [],
      edges: [
        {
          id: "missing-edge",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    expect(() => buildDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
      "Layout result references an unknown diagram edge: missing-edge",
    );
  });
});
