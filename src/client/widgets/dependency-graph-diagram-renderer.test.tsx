import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { DependencyGraphDiagramRenderer } from "@/client/widgets/dependency-graph-diagram-renderer";
import type { DiagramRendererProps } from "@/client/widgets/diagram-renderer-base";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const diagram = {
  id: "dependencies",
  title: "Dependencies",
  generator: "built-in:freeform",
  layout: { id: "dependency-graph" },
  graph: {
    groups: [
      { id: "source", title: "Source" },
      { id: "target", title: "Target" },
    ],
    nodes: [
      { id: "one", type: "default", title: "One", groupId: "source" },
      { id: "two", type: "default", title: "Two", groupId: "source" },
      { id: "other", type: "default", title: "Other", groupId: "target" },
    ],
    edges: [
      { id: "one-other", type: "default", source: "one", target: "other" },
      { id: "two-other", type: "default", source: "two", target: "other" },
      { id: "one-two", type: "default", source: "one", target: "two" },
    ],
  },
} satisfies Diagram;

const layout = {
  groups: [
    { id: "source", position: { x: 0, y: 0 }, size: { width: 400, height: 400 } },
    { id: "target", position: { x: 0, y: 600 }, size: { width: 400, height: 220 } },
  ],
  nodes: [
    { id: "one", parentId: "source", position: { x: 50, y: 90 }, size: { width: 288, height: 80 } },
    { id: "two", parentId: "source", position: { x: 50, y: 250 }, size: { width: 288, height: 80 } },
    { id: "other", parentId: "target", position: { x: 50, y: 90 }, size: { width: 288, height: 80 } },
  ],
  edges: [
    {
      id: "one-other",
      points: [
        { x: 194, y: 170 },
        { x: 194, y: 690 },
      ],
    },
    {
      id: "two-other",
      points: [
        { x: 194, y: 330 },
        { x: 194, y: 690 },
      ],
    },
    {
      id: "one-two",
      points: [
        { x: 194, y: 170 },
        { x: 194, y: 250 },
      ],
    },
  ],
  initialView: { mode: "fit" },
} satisfies DiagramLayout;

vi.mock("@/client/widgets/diagram-renderer-base", () => ({
  DiagramRendererBase: ({
    buildRenderModel,
    diagram,
    onOpenSource,
    onNodeActivate,
    onPaneActivate,
  }: {
    buildRenderModel: (
      diagram: Diagram,
      layout: DiagramLayout,
      onOpenSource: (href: string) => void,
    ) => ReturnType<
      typeof import("@/client/widgets/dependency-graph-diagram-renderer.react-flow").buildDependencyGraphDiagramReactFlowRenderModel
    >;
    diagram: Diagram;
    onOpenSource: (href: string) => void;
    onNodeActivate?: (id: string) => void;
    onPaneActivate?: () => void;
  }) => {
    const model = buildRenderModel(diagram, layout, onOpenSource);
    const group = model.nodes.find((node) => node.type === "labeled-group" && node.id === "source");
    const aggregate = model.edges.find((edge) => edge.type === "route" && edge.source === "source");
    return (
      <div>
        <output data-testid="visible-edges">{model.edges.map(({ id }) => id).join("|")}</output>
        <button onClick={() => (group?.type === "labeled-group" ? group.data.onTitleActivate?.() : undefined)}>
          Select group
        </button>
        <button onClick={() => onNodeActivate?.("one")}>Select node</button>
        <button onClick={() => onPaneActivate?.()}>Clear focus</button>
        {aggregate?.type === "route" ? aggregate.data?.eyebrow : null}
      </div>
    );
  },
}));

const annotations = { isCommentMode: false, isManaging: false, isPublishing: false } as AnnotationCanvasController;
const props: DiagramRendererProps = { diagram, annotations, onOpenSource: vi.fn() };

describe("dependency graph focus", () => {
  it("switches among group, node, aggregate, and no-focus projections without relayout", async () => {
    const { rerender } = render(<DependencyGraphDiagramRenderer {...props} commentEnabled={false} />);
    const visible = screen.getByTestId("visible-edges");

    expect(visible.textContent?.split("|")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Select group" }));
    expect(visible.textContent?.split("|")).toHaveLength(2);
    expect(visible).toHaveTextContent("one-two");

    await userEvent.click(screen.getByRole("button", { name: "Select node" }));
    expect(visible.textContent?.split("|")).toHaveLength(2);
    expect(visible).toHaveTextContent("one-other|one-two");

    await userEvent.click(screen.getByRole("button", { name: "Clear focus" }));
    await userEvent.click(screen.getByRole("button", { name: "Show 2 edges from source to target" }));
    expect(visible).toHaveTextContent("one-other|two-other");

    rerender(
      <DependencyGraphDiagramRenderer
        {...props}
        commentEnabled
        annotations={{ ...annotations, isCommentMode: true }}
      />,
    );
    expect(visible).toHaveTextContent("one-other|two-other");
    expect(screen.queryByRole("button", { name: "Show 2 edges from source to target" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Select node" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear focus" }));
    expect(visible).toHaveTextContent("one-other|two-other");

    rerender(<DependencyGraphDiagramRenderer {...props} commentEnabled={false} />);
    expect(visible).toHaveTextContent("one-other|two-other");
    await userEvent.click(screen.getByRole("button", { name: "Clear focus" }));
    expect(visible.textContent?.split("|")).toHaveLength(1);
  });

  it("does not enable focus when the Comment toggle is on during management", async () => {
    render(
      <DependencyGraphDiagramRenderer {...props} annotations={{ ...annotations, isManaging: true }} commentEnabled />,
    );
    const visible = screen.getByTestId("visible-edges");

    await userEvent.click(screen.getByRole("button", { name: "Select group" }));
    await userEvent.click(screen.getByRole("button", { name: "Select node" }));
    expect(visible.textContent?.split("|")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show 2 edges from source to target" })).not.toBeInTheDocument();
  });
});
