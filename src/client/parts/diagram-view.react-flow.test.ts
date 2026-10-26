import { MarkerType } from "@xyflow/react";

import {
  buildDiagramMeasurementNodes,
  buildDiagramReactFlowNodes,
  resolveDiagramNodeSizes,
  toMessageReactFlowEdge,
} from "@/client/parts/diagram-view.react-flow";
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
          synthetic: false,
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

describe("diagram view React Flow adapter", () => {
  it("omits the card eyebrow when a default node has no kind", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [{ synthetic: false, nodeId: "component", type: "default", title: "Component" }],
          edges: [],
        },
      },
    } satisfies Artifact;

    const [measurementNode] = buildDiagramMeasurementNodes(diagram, vi.fn());

    expect(measurementNode?.data).toMatchObject({ label: "Component" });
    expect(measurementNode?.data).not.toHaveProperty("eyebrow");
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
        layout: { layoutId: "general" },
        graph: {
          ...sequenceDiagram.diagram.graph,
          nodes: [
            { synthetic: false, nodeId: "default", type: "default", kind: "step", title: "Default" },
            {
              synthetic: false,
              nodeId: "lifeline",
              type: "lifeline",
              kind: "participant",
              title: "Lifeline",
              activations: [],
            },
            {
              synthetic: false,
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

  it("measures a supplied set of projected IDs without knowing their graph types", () => {
    expect(resolveDiagramNodeSizes(["projected"], [{ id: "projected", type: "diamond", data: {} }])).toEqual({
      projected: { height: 48, width: 48 },
    });
    expect(() => resolveDiagramNodeSizes(["projected"], [])).toThrow(
      "React Flow did not measure diagram node: projected",
    );
  });

  it("keeps authored diamond titles and bounding group metadata in the placed model", () => {
    const artifact = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [
            {
              groupId: "boundary",
              type: "bounding",
              title: "Boundary",
              synthetic: false,
              description: "Review region",
              hideTitle: true,
            },
          ],
          nodes: [{ synthetic: false, nodeId: "choice", type: "diamond", title: "Continue?", groupId: "boundary" }],
          edges: [],
        },
      },
    } satisfies Artifact;
    const layout = {
      groups: [{ id: "boundary", position: { x: 0, y: 0 }, size: { width: 300, height: 240 } }],
      nodes: [{ id: "choice", parentId: "boundary", position: { x: 40, y: 60 }, size: { width: 160, height: 112 } }],
      edges: [],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;
    const measurementNodes = buildDiagramMeasurementNodes(artifact, vi.fn());
    expect(measurementNodes.at(0)).toMatchObject({ type: "diamond", data: { label: "Continue?" } });
    expect(resolveDiagramNodeSizes(artifact.diagram, measurementNodes)).toEqual({
      choice: { width: 160, height: 112 },
    });
    expect(buildDiagramReactFlowNodes(artifact, layout, vi.fn())).toMatchObject([
      {
        id: "boundary",
        type: "bounding-group",
        data: { label: "Boundary", description: "Review region", hideTitle: true },
      },
      { id: "choice", type: "diamond", parentId: "boundary", data: { label: "Continue?" } },
    ]);
  });

  it.each([
    { messageType: "sync", marker: MarkerType.ArrowClosed, dash: undefined },
    { messageType: "async", marker: MarkerType.Arrow, dash: undefined },
    { messageType: "return", marker: MarkerType.Arrow, dash: "6 4" },
  ] as const)("preserves $messageType notation using the connection display type", ({ messageType, marker, dash }) => {
    const onLinkActivate = vi.fn();
    const edge = toMessageReactFlowEdge(
      {
        edgeId: "message",
        type: "message",
        sourceNodeId: "client",
        targetNodeId: "server",
        messageType,
        label: "Request",
        href: "source:///request.ts",
        kind: "interaction",
      },
      [
        { x: 112, y: 200 },
        { x: 412, y: 200 },
      ],
      onLinkActivate,
    );
    expect(edge).toMatchObject({
      type: "connection",
      source: "client",
      target: "server",
      label: "Request",
      sourceHandle: "message:source",
      targetHandle: "message:target",
      markerEnd: { type: marker, color: "var(--diagram-edge)" },
      style: { stroke: "var(--diagram-edge)", strokeWidth: 2 },
      data: {
        path: "M 112 200 L 412 200",
        labelPosition: { x: 262, y: 188 },
        labelTransform: "translate(-50%, -100%)",
        href: "source:///request.ts",
        onLinkActivate,
      },
    });
    expect(edge.style?.strokeDasharray).toBe(dash);
    expect(edge.data).not.toHaveProperty("eyebrow");
  });

  it("places self-message labels above the outgoing segment", () => {
    const edge = toMessageReactFlowEdge(
      {
        edgeId: "self",
        type: "message",
        sourceNodeId: "client",
        targetNodeId: "client",
        messageType: "sync",
        label: "Retry",
      },
      [
        { x: 100, y: 200 },
        { x: 160, y: 200 },
        { x: 160, y: 240 },
        { x: 100, y: 240 },
      ],
      vi.fn(),
    );
    expect(edge.data).toMatchObject({
      path: "M 100 200 L 160 200 L 160 240 L 100 240",
      labelPosition: { x: 160, y: 188 },
      labelTransform: "translate(-50%, -100%)",
    });
  });
});
