import { buildGeneralDiagramReactFlowRenderModel } from "@/client/widgets/general-diagram-renderer";
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

describe("general diagram React Flow adapter", () => {
  it("converts default artifact elements to the generic React Flow contract", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          ...sequenceDiagram.diagram.graph,
          groups: [{ synthetic: false, type: "default", groupId: "group", title: "Group", description: "Boundary" }],
          nodes: [
            {
              synthetic: false,
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

    const { nodes, edges } = buildGeneralDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(nodes.find(({ id }) => id === "step")).toMatchObject({
      type: "rectangle",
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
      type: "connection",
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
  it("keeps inline render edges unlabeled", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [
            {
              synthetic: false,
              nodeId: "parent",
              type: "default",
              kind: "React component",
              title: "Parent",
              links: [],
            },
            { synthetic: false, nodeId: "child", type: "default", kind: "React component", title: "Child", links: [] },
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

    const { edges } = buildGeneralDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.at(0)).not.toHaveProperty("label");
    expect(edges.at(0)?.data).not.toHaveProperty("eyebrow");
  });

  it("preserves case-sensitive prop names in relationship kinds", () => {
    const diagram = {
      ...sequenceDiagram,
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [
            { synthetic: false, nodeId: "renderer", type: "default", kind: "React component", title: "Renderer" },
            { synthetic: false, nodeId: "content", type: "default", kind: "React component", title: "Content" },
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

    const { edges } = buildGeneralDiagramReactFlowRenderModel(diagram, layout, vi.fn());

    expect(edges.at(0)).toMatchObject({
      label: "from App",
      data: { eyebrow: "RENDER (fooBar)" },
    });
  });
  it("rejects a group missing from the layout result", () => {
    const layout = {
      groups: [{ id: "missing-group", position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
      nodes: [],
      edges: [],
      initialView: { mode: "fit" },
    } satisfies DiagramLayout;

    expect(() => buildGeneralDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
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

    expect(() => buildGeneralDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
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

    expect(() => buildGeneralDiagramReactFlowRenderModel(sequenceDiagram, layout, vi.fn())).toThrow(
      "Layout result references an unknown diagram edge: missing-edge",
    );
  });
});
