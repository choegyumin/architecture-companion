import { render, screen } from "@testing-library/react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { Artifact } from "@/features/artifact/artifact";

vi.mock("@/client/widgets/dependency-graph-diagram-renderer", () => ({
  DependencyGraphDiagramRenderer: () => <span>Dependency graph renderer</span>,
}));
vi.mock("@/client/widgets/elk-layered-diagram-renderer", () => ({
  ElkLayeredDiagramRenderer: () => <span>ELK layout renderer</span>,
}));
vi.mock("@/client/widgets/sequence-diagram-renderer", () => ({
  SequenceDiagramRenderer: () => <span>Sequence layout renderer</span>,
}));

const annotations = {} as AnnotationCanvasController;
const diagram = {
  id: "example",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Example",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview the selected diagram layout.\n\n## Regeneration\nRebuild the example elements for the selected layout.",
  diagram: {
    layout: { id: "elk-layered" },
    graph: { groups: [], nodes: [{ id: "node", type: "default", title: "Node" }], edges: [] },
  },
} as const;

describe("diagram renderer selection", () => {
  it("selects the dependency renderer by layout ID", () => {
    const dependencyDiagram = {
      ...diagram,
      diagram: { ...diagram.diagram, layout: { id: "dependency-graph" } },
    } satisfies Artifact;

    render(<DiagramRenderer annotations={annotations} artifact={dependencyDiagram} onOpenSource={vi.fn()} />);

    expect(screen.getByText("Dependency graph renderer")).toBeInTheDocument();
    expect(screen.queryByText("ELK layout renderer")).not.toBeInTheDocument();
  });

  it("selects the ELK renderer by layout ID", () => {
    render(<DiagramRenderer annotations={annotations} artifact={diagram} onOpenSource={vi.fn()} />);

    expect(screen.getByText("ELK layout renderer")).toBeInTheDocument();
    expect(screen.queryByText("Sequence layout renderer")).not.toBeInTheDocument();
  });

  it("selects the sequence renderer by layout ID", () => {
    const sequenceDiagram = {
      ...diagram,
      diagram: {
        layout: { id: "sequence" },
        graph: {
          groups: [],
          nodes: [{ id: "participant", type: "lifeline", kind: "participant", title: "Participant", activations: [] }],
          edges: [],
        },
      },
    } satisfies Artifact;

    render(<DiagramRenderer annotations={annotations} artifact={sequenceDiagram} onOpenSource={vi.fn()} />);

    expect(screen.getByText("Sequence layout renderer")).toBeInTheDocument();
    expect(screen.queryByText("ELK layout renderer")).not.toBeInTheDocument();
  });
});
