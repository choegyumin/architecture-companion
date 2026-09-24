import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import {
  type AnnotationAnchor,
  type AnnotationDocument,
  parseAnnotationDocument,
} from "@/features/annotation/annotation-document";
import { type AnnotationDraft, createAnnotationDraft } from "@/features/annotation/create-annotation-draft";
import type { Diagram } from "@/features/diagram/diagram";

const sizes = {
  one: { width: 288, height: 80 },
  two: { width: 288, height: 80 },
  other: { width: 288, height: 80 },
};
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

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNodesState: (initial: unknown[]) => {
    const [nodes, setNodes] = useState(initial);
    return [nodes, setNodes, vi.fn()];
  },
  useReactFlow: () => ({ getNodes: () => [] }),
}));
vi.mock("@/client/widgets/diagram-renderer.react-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/widgets/diagram-renderer.react-flow")>()),
  resolveDiagramNodeSizes: () => sizes,
}));
vi.mock("@/client/parts/diagram-canvas", () => ({
  DiagramCanvas: ({
    edges,
    onCanvasClick,
    onNodeActivate,
    onPaneActivate,
  }: {
    edges: readonly { id: string; source: string; target: string }[];
    onCanvasClick?: (point: { x: number; y: number }, target: { type: "edge"; id: string }) => void;
    onNodeActivate?: (id: string) => void;
    onPaneActivate?: () => void;
  }) => {
    const aggregate = edges.find(({ source, target }) => source === "source" && target === "target");
    const original = edges.find(({ id }) => id === "one-other");
    return (
      <div>
        <output data-testid="visible-edges">{edges.map(({ id }) => id).join("|")}</output>
        <button onClick={() => aggregate && onCanvasClick?.({ x: 40, y: 75 }, { type: "edge", id: aggregate.id })}>
          Comment aggregate
        </button>
        <button onClick={() => original && onCanvasClick?.({ x: 50, y: 85 }, { type: "edge", id: original.id })}>
          Comment original
        </button>
        <button onClick={() => onNodeActivate?.("one")}>Focus node</button>
        <button onClick={() => onPaneActivate?.()}>Clear focus</button>
      </div>
    );
  },
}));
vi.mock("@/shared/react-flow/base-overlay-panel", () => ({ BaseOverlayPanel: () => null }));
vi.mock("@/client/widgets/diagram-links-panel", () => ({ DiagramLinksPanel: () => null }));

describe("dependency graph Comment snapshot", () => {
  it("saves aggregate endpoints, original IDs, and canvas point from click time after focus changes", async () => {
    let document: AnnotationDocument = { annotations: [] };
    let nextId = 0;
    const drafts = createAnnotationDraft({
      repository: {
        load: async () => document,
        save: async (next) => {
          document = parseAnnotationDocument(next);
        },
      },
      currentUser: { load: async () => ({ id: "reviewer", name: "Reviewer" }) },
      createId: () => `id-${++nextId}`,
      now: () => "2026-09-24T00:00:00.000Z",
    });
    let clickedDraft: AnnotationDraft | undefined;

    function Review() {
      const [commentEnabled, setCommentEnabled] = useState(true);
      const [draft, setDraft] = useState<AnnotationDraft>();
      const annotations = {
        surface: { canvasId: "design:dependencies" },
        isCommentMode: commentEnabled,
        isManaging: false,
        isPublishing: false,
        begin: (anchor: AnnotationAnchor) => {
          clickedDraft = drafts.begin(anchor);
          setDraft(clickedDraft);
        },
      } as AnnotationCanvasController;
      return (
        <div>
          <button onClick={() => setCommentEnabled(!commentEnabled)}>Toggle Comment</button>
          <output data-testid="draft">{JSON.stringify(draft?.anchor)}</output>
          <DiagramRenderer
            annotations={annotations}
            commentEnabled={commentEnabled}
            diagram={diagram}
            onOpenSource={vi.fn()}
          />
        </div>
      );
    }

    render(<Review />);
    await waitFor(() => expect(screen.getByTestId("visible-edges").textContent).toContain("aggregate:"));
    await userEvent.click(screen.getByRole("button", { name: "Comment aggregate" }));
    expect(clickedDraft?.anchor).toEqual({
      canvasId: "design:dependencies",
      point: { x: 40, y: 75 },
      target: { type: "edge-set", sourceId: "source", targetId: "target", edgeIds: ["one-other", "two-other"] },
    });

    await userEvent.click(screen.getByRole("button", { name: "Toggle Comment" }));
    await userEvent.click(screen.getByRole("button", { name: "Focus node" }));
    expect(screen.getByTestId("visible-edges")).toHaveTextContent("one-other|one-two");
    expect(JSON.parse(screen.getByTestId("draft").textContent ?? "null")).toEqual(clickedDraft?.anchor);
    if (!clickedDraft) throw new Error("Missing aggregate draft");
    expect((await drafts.publish(drafts.change(clickedDraft, "Review both dependencies"))).status).toBe("published");
    expect(document.annotations.at(0)?.anchor).toEqual(clickedDraft.anchor);

    await userEvent.click(screen.getByRole("button", { name: "Toggle Comment" }));
    await userEvent.click(screen.getByRole("button", { name: "Comment original" }));
    expect(clickedDraft?.anchor).toEqual({
      canvasId: "design:dependencies",
      point: { x: 50, y: 85 },
      target: { type: "edge", id: "one-other" },
    });
  });
});
