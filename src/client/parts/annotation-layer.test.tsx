import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { AnnotationLayer } from "@/client/parts/annotation-layer";

const controller: AnnotationCanvasController = {
  begin: vi.fn(),
  cancel: vi.fn(),
  change: vi.fn(),
  changeEdit: vi.fn(),
  closeEdit: vi.fn(),
  document: {
    version: 1,
    annotations: [
      {
        id: "thread-1",
        anchor: {
          canvasId: "process:checkout",
          point: { x: 120, y: 80 },
        },
        comment: {
          id: "comment-1",
          author: { id: "reviewer-1", name: "Ada" },
          body: "Review this area.",
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      },
    ],
  },
  isCommentMode: false,
  isManaging: false,
  isPublishing: false,
  move: vi.fn(async () => undefined),
  open: vi.fn(),
  publish: vi.fn(async () => undefined),
  removeEdit: vi.fn(async () => undefined),
  resolveEditConflict: vi.fn(async () => undefined),
  saveEdit: vi.fn(async () => true),
  surface: { canvasId: "process:checkout" },
};

describe("annotation layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders comment pins at projected screen coordinates", () => {
    render(
      <AnnotationLayer
        bounds={{ height: 400, width: 600 }}
        canvasToScreenPoint={({ x, y }) => ({ x: x * 2 + 20, y: y * 2 + 40 })}
        controller={controller}
        screenToCanvasPoint={(point) => point}
      />,
    );

    expect(screen.getByRole("button", { name: "Comment: Review this area." })).toHaveStyle({
      left: "260px",
      top: "200px",
    });
  });

  it("moves a dragged comment pin and ignores the following click", async () => {
    render(
      <AnnotationLayer
        bounds={{ height: 400, width: 600 }}
        canvasToScreenPoint={(point) => point}
        controller={controller}
        screenToCanvasPoint={({ x, y }) => ({ x: x / 2, y: y / 2 })}
      />,
    );
    const pin = screen.getByRole("button", { name: "Comment: Review this area." });

    fireEvent.pointerDown(pin, { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(pin, { clientX: 140, clientY: 180, pointerId: 7 });
    fireEvent.pointerUp(pin, { pointerId: 7 });
    fireEvent.click(pin);

    await waitFor(() => {
      expect(controller.move).toHaveBeenCalledWith("thread-1", { x: 70, y: 90 });
    });
    expect(controller.open).not.toHaveBeenCalled();
  });

  it("opens the comment instead of moving it when pointer movement stays below the drag threshold", () => {
    render(
      <AnnotationLayer
        bounds={{ height: 400, width: 600 }}
        canvasToScreenPoint={(point) => point}
        controller={controller}
        screenToCanvasPoint={(point) => point}
      />,
    );
    const pin = screen.getByRole("button", { name: "Comment: Review this area." });

    fireEvent.pointerDown(pin, { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(pin, { clientX: 102, clientY: 102, pointerId: 7 });
    fireEvent.pointerUp(pin, { pointerId: 7 });
    fireEvent.click(pin);

    expect(controller.move).not.toHaveBeenCalled();
    expect(controller.open).toHaveBeenCalledWith("thread-1");
  });
});
