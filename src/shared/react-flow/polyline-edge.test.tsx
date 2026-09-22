import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PolylineEdge } from "@/shared/react-flow/polyline-edge";

vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path }: { path: string }) => (
    <svg>
      <path d={path} />
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
});
