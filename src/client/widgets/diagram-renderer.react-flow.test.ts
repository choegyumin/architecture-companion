import { MarkerType } from "@xyflow/react";

import { buildDiagramMeasurementNodes, resolveDiagramNodeSizes } from "@/client/widgets/diagram-renderer.react-flow";
import { buildElkLayeredDiagramReactFlowRenderModel } from "@/client/widgets/elk-layered-diagram-renderer.react-flow";
import { buildSequenceDiagramReactFlowRenderModel } from "@/client/widgets/sequence-diagram-renderer.react-flow";
import type { Artifact } from "@/features/artifact/artifact";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const sequenceDiagram = {
  artifactId: ".architecture-companion/artifacts/sequence.archcomp.json",
  type: "behavior",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Sequence",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview participant interactions.\n\n## Regeneration\nRebuild lifelines and messages from the interaction flow.",
  diagram: {
    layout: { layoutId: "sequence" },
    graph: {
      groups: [],
      nodes: [
        {
          nodeId: "participant",
          type: "lifeline",
          kind: "participant",
          title: "Participant",
          links: [{ href: "source:///src/participant.ts" }],
          activations: [],
        },
      ],
      edges: [],
    },
  },
} satisfies Artifact;

describe("diagram renderer React Flow adapter", () => {
  it("converts default artifact elements to the generic React Flow contract", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          ...sequenceDiagram.diagram.graph,
          groups: [{ groupId: "group", title: "Group", description: "Boundary" }],
          nodes: [
            {
              nodeId: "step",
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
              edgeId: "next",
              type: "default",
              sourceNodeId: "step",
              targetNodeId: "step",
              kind: "result",
              label: "Continue",
              href: "https://example.com/review",
            },
          ],
        },
      },
    } satisfies Artifact;
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
            { x: 200, y: 180 },
          ],
        },
      ],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const [measurementNode] = buildDiagramMeasurementNodes(diagram, vi.fn());
    const { nodes, edges } = buildElkLayeredDiagramReactFlowRenderModel(diagram, layout, vi.fn());

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
    expect(nodes.find((node) => node.id === "step")?.data).not.toHaveProperty("activatable");
    expect(edges.at(0)).toMatchObject({
      id: "next",
      source: "step",
      target: "step",
      type: "route",
      label: "Continue",
      markerEnd: { color: "var(--diagram-edge)" },
      style: { stroke: "var(--diagram-edge)" },
      data: {
        path: "M 100 100 L 200 160 L 200 180",
        labelPosition: { x: 150, y: 130 },
        eyebrow: "result",
        href: "https://example.com/review",
      },
    });
  });

  it("omits the card eyebrow when a default node has no kind", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ nodeId: "component", type: "default", title: "Component" }],
          edges: [],
        },
      },
    } satisfies Artifact;

    const [measurementNode] = buildDiagramMeasurementNodes(diagram, vi.fn());

    expect(measurementNode?.data).toMatchObject({ label: "Component" });
    expect(measurementNode?.data).not.toHaveProperty("eyebrow");
  });

  it("keeps inline render edges unlabeled", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [
            { nodeId: "parent", type: "default", kind: "React component", title: "Parent", links: [] },
            { nodeId: "child", type: "default", kind: "React component", title: "Child", links: [] },
          ],
          edges: [
            {
              edgeId: "render",
              type: "default",
              sourceNodeId: "parent",
              targetNodeId: "child",
              kind: "inline-render",
            },
          ],
        },
      },
    } satisfies Artifact;
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

    const { edges } = buildElkLayeredDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.at(0)).not.toHaveProperty("label");
    expect(edges.at(0)?.data).not.toHaveProperty("eyebrow");
  });

  it("preserves case-sensitive prop names in relationship kinds", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [
            { nodeId: "renderer", type: "default", kind: "React component", title: "Renderer" },
            { nodeId: "content", type: "default", kind: "React component", title: "Content" },
          ],
          edges: [
            {
              edgeId: "render",
              type: "default",
              sourceNodeId: "renderer",
              targetNodeId: "content",
              kind: "RENDER (fooBar)",
              label: "from App",
            },
          ],
        },
      },
    } satisfies Artifact;
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

    const { edges } = buildElkLayeredDiagramReactFlowRenderModel(diagram, layout, vi.fn());

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

    expect(
      resolveDiagramNodeSizes(sequenceDiagram.diagram, [{ ...lifeline, measured: { height: 320, width: 240 } }]),
    ).toEqual({
      participant: { height: 320, width: 240 },
    });
  });

  it("uses renderer sizes for node types that are not measured", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          ...sequenceDiagram.diagram.graph,
          nodes: [
            { nodeId: "default", type: "default", kind: "step", title: "Default" },
            { nodeId: "lifeline", type: "lifeline", kind: "participant", title: "Lifeline", activations: [] },
            {
              nodeId: "fragment",
              type: "fragment",
              kind: "phase",
              title: "Fragment",
              operator: "opt",
              branches: [],
            },
          ],
        },
      },
    } satisfies Artifact;
    const nodes = buildDiagramMeasurementNodes(diagram, vi.fn());

    expect(resolveDiagramNodeSizes(diagram.diagram, nodes)).toEqual({
      default: { height: 144, width: 288 },
      lifeline: { height: 160, width: 224 },
      fragment: { height: 160, width: 448 },
    });
  });

  it("rejects a diagram node without a React Flow measurement node", () => {
    expect(() => resolveDiagramNodeSizes(sequenceDiagram.diagram, [])).toThrow(
      "React Flow did not measure diagram node: participant",
    );
  });

  it("renders sequence message direction and type with UML edge notation", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        ...sequenceDiagram.diagram,
        graph: {
          ...sequenceDiagram.diagram.graph,
          nodes: [
            {
              nodeId: "client",
              type: "lifeline",
              kind: "participant",
              title: "Client",
              links: [],
              activations: [],
            },
            {
              nodeId: "server",
              type: "lifeline",
              kind: "participant",
              title: "Server",
              links: [],
              activations: [],
            },
          ],
          edges: [
            { edgeId: "sync", type: "message", sourceNodeId: "client", targetNodeId: "server", messageType: "sync" },
            { edgeId: "async", type: "message", sourceNodeId: "client", targetNodeId: "server", messageType: "async" },
            {
              edgeId: "return",
              type: "message",
              sourceNodeId: "server",
              targetNodeId: "client",
              messageType: "return",
            },
          ],
        },
      },
    } satisfies Artifact;
    const layout = {
      nodes: diagram.diagram.graph.nodes.map(({ nodeId }, index) => ({
        id: nodeId,
        position: { x: index * 300, y: 0 },
        size: { width: 224, height: 400 },
      })),
      groups: [],
      edges: diagram.diagram.graph.edges.map(({ edgeId }, index) => ({
        id: edgeId,
        points: [
          { x: 112, y: 200 + index * 72 },
          { x: 412, y: 200 + index * 72 },
        ],
      })),
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    const { edges } = buildSequenceDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.map(({ markerEnd }) => markerEnd)).toEqual([
      expect.objectContaining({ type: MarkerType.ArrowClosed, color: "var(--diagram-edge)" }),
      expect.objectContaining({ type: MarkerType.Arrow, color: "var(--diagram-edge)" }),
      expect.objectContaining({ type: MarkerType.Arrow, color: "var(--diagram-edge)" }),
    ]);
    expect(edges.map(({ style }) => style?.stroke)).toEqual(Array(3).fill("var(--diagram-edge)"));
    expect(edges.map(({ style }) => style?.strokeDasharray)).toEqual([undefined, undefined, "6 4"]);
    expect(edges.map(({ type, sourceHandle, targetHandle }) => ({ type, sourceHandle, targetHandle }))).toEqual([
      { type: "message", sourceHandle: "sync:source", targetHandle: "sync:target" },
      { type: "message", sourceHandle: "async:source", targetHandle: "async:target" },
      { type: "message", sourceHandle: "return:source", targetHandle: "return:target" },
    ]);
    edges.forEach(({ data }) => {
      expect(data).toHaveProperty("onLinkActivate", expect.any(Function));
    });

    const elkEdges = buildElkLayeredDiagramReactFlowRenderModel(
      { ...diagram, diagram: { ...diagram.diagram, layout: { layoutId: "elk-layered" } } },
      layout,
      vi.fn(),
    ).edges;
    expect(elkEdges.map(({ type, markerEnd, style }) => ({ type, markerEnd, style }))).toEqual(
      edges.map(({ type, markerEnd, style }) => ({ type, markerEnd, style })),
    );
  });

  it("rejects a group missing from the layout result", () => {
    const layout = {
      groups: [{ id: "missing-group", position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
      nodes: [],
      edges: [],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    expect(() => buildElkLayeredDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
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

    expect(() => buildElkLayeredDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
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

    expect(() => buildElkLayeredDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
      "Layout result references an unknown diagram edge: missing-edge",
    );
  });
});
