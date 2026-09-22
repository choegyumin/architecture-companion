import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PolylineEdge } from "@/shared/react-flow/polyline-edge";

vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path }: { path: string }) => (
    <svg>
      <path d={path} data-testid="edge-path" />
    </svg>
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("polyline edge", () => {
  it("renders an interactive aggregate label as a button", () => {
    const onLabelActivate = vi.fn();
    const props = {
      id: "aggregate",
      source: "source",
      target: "target",
      label: "×2",
      data: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        labelAriaLabel: "Show 2 underlying dependencies",
        onLabelActivate,
      },
    } as unknown as ComponentProps<typeof PolylineEdge>;

    render(<PolylineEdge {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 underlying dependencies" }));

    expect(onLabelActivate).toHaveBeenCalledOnce();
  });

  it("renders routed points as a continuous curve", () => {
    const props = {
      id: "curved",
      source: "source",
      target: "target",
      data: {
        curved: true,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 200 },
        ],
      },
    } as unknown as ComponentProps<typeof PolylineEdge>;

    render(<PolylineEdge {...props} />);

    expect(screen.getByTestId("edge-path")).toHaveAttribute(
      "d",
      "M 0 0 L 0 50 Q 0 100 50 100 L 50 100 Q 100 100 100 150 L 100 200",
    );
  });
});
