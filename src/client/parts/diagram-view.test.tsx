import { fireEvent, render, screen } from "@testing-library/react";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { DiagramView } from "@/client/parts/diagram-view";
import type { Artifact } from "@/features/artifact/artifact";
import type { DiagramLink } from "@/features/diagram/diagram-graph";

function renderView(links: readonly DiagramLink[], onOpenSource = vi.fn()) {
  const artifact = {
    artifactId: ".architecture-companion/artifacts/links.archcomp.json",
    type: "design",
    updatedAt: "2026-10-03T09:15:00.000Z",
    title: "Links",
    generator: "built-in:freeform",
    instructions: "## Purpose\nReview links.\n\n## Regeneration\nRebuild links.",
    links: [...links],
    diagram: { layout: { layoutId: "general" }, graph: { groups: [], nodes: [], edges: [] } },
  } satisfies Artifact;
  const annotations = {
    document: { annotations: [] },
    surface: { canvasId: artifact.artifactId },
    isCommentMode: false,
    isManaging: false,
    isPublishing: false,
    begin: vi.fn(),
    change: vi.fn(),
    changeEdit: vi.fn(),
    cancel: async () => true,
    closeEdit: async () => true,
    move: async () => {},
    open: vi.fn(),
    publish: async () => {},
    removeEdit: async () => {},
    resolveEditConflict: vi.fn(),
    saveEdit: async () => true,
  } satisfies AnnotationCanvasController;
  return render(
    <DiagramView
      annotations={annotations}
      artifact={artifact}
      onOpenSource={onOpenSource}
      calculateLayout={async () => ({ groups: [], nodes: [], edges: [], initialView: { mode: "fit" } })}
      buildRenderModel={() => ({ nodes: [], edges: [] })}
    />,
  );
}

describe("diagram view artifact links", () => {
  it("omits the links panel when there are no links", () => {
    renderView([]);
    expect(screen.queryByRole("navigation", { name: "Artifact links" })).not.toBeInTheDocument();
  });

  it("shows source link names and requests opening the source", () => {
    const onOpenSource = vi.fn();
    renderView(
      [
        { href: "source:///specs/user-review-architecture.spec.tsx" },
        { text: "User Journey Test", href: "source:///specs/other.spec.tsx" },
      ],
      onOpenSource,
    );

    const inferredLabelLink = screen.getByRole("button", { name: "Open user-review-architecture.spec.tsx" });
    expect(screen.getByRole("button", { name: "Open User Journey Test" })).toBeInTheDocument();
    fireEvent.click(inferredLabelLink);
    expect(onOpenSource).toHaveBeenCalledWith("source:///specs/user-review-architecture.spec.tsx");
  });

  it("keeps external links as new-tab links", () => {
    const onOpenSource = vi.fn();
    renderView([{ href: "https://example.com/docs" }], onOpenSource);
    const link = screen.getByRole("button", { name: "Open https://example.com/docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    fireEvent.click(link);
    expect(onOpenSource).not.toHaveBeenCalled();
  });
});
