import { render, screen } from "@testing-library/react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { Diagram } from "@/features/diagram/diagram";

vi.mock("@/client/widgets/elk-layered-diagram-renderer", () => ({
  ElkLayeredDiagramRenderer: () => <span>ELK layout renderer</span>,
}));
vi.mock("@/client/widgets/sequence-diagram-renderer", () => ({
  SequenceDiagramRenderer: () => <span>Sequence layout renderer</span>,
}));

const annotations = {} as AnnotationCanvasController;
const diagram = {
  id: "example",
  title: "Example",
  generator: "built-in:freeform",
  graph: { groups: [], nodes: [{ id: "node", type: "default", title: "Node" }], edges: [] },
} as const;

describe("diagram renderer selection", () => {
  it("selects the ELK renderer by layout ID", () => {
    const elkDiagram = { ...diagram, layout: { id: "elk-layered" } } satisfies Diagram;

    render(<DiagramRenderer annotations={annotations} diagram={elkDiagram} onOpenSource={vi.fn()} />);

    expect(screen.getByText("ELK layout renderer")).toBeInTheDocument();
    expect(screen.queryByText("Sequence layout renderer")).not.toBeInTheDocument();
  });

  it("selects the sequence renderer by layout ID", () => {
    const sequenceDiagram = {
      ...diagram,
      graph: {
        groups: [],
        nodes: [{ id: "participant", type: "lifeline", kind: "participant", title: "Participant", activations: [] }],
        edges: [],
      },
      layout: { id: "sequence" },
    } satisfies Diagram;

    render(<DiagramRenderer annotations={annotations} diagram={sequenceDiagram} onOpenSource={vi.fn()} />);

    expect(screen.getByText("Sequence layout renderer")).toBeInTheDocument();
    expect(screen.queryByText("ELK layout renderer")).not.toBeInTheDocument();
  });
});
