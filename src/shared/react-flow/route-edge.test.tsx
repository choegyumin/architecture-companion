import { fireEvent, render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import type { ReactNode } from "react";

import { RouteEdge } from "@/shared/react-flow/route-edge";

vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path }: { path: string }) => (
    <svg>
      <path d={path} data-testid="edge-path" />
    </svg>
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  Position: { Left: "left", Right: "right" },
}));

describe("route edge", () => {
  it("renders the supplied SVG path and label position without computing them from points", () => {
    const onLinkActivate = vi.fn();
    render(
      <RouteEdge
        data={{
          path: "M 0 0 C 20 10 40 90 100 100",
          labelPosition: { x: 70, y: 25 },
          eyebrow: "dependency",
          href: "https://example.com",
          onLinkActivate,
        }}
        id="edge"
        label="Open dependency"
        source="source"
        sourcePosition={Position.Right}
        sourceX={0}
        sourceY={0}
        target="target"
        targetPosition={Position.Left}
        targetX={100}
        targetY={100}
        type="route"
      />,
    );

    expect(screen.getByTestId("edge-path")).toHaveAttribute("d", "M 0 0 C 20 10 40 90 100 100");
    const link = screen.getByRole("link", { name: "Open dependency" });
    expect(link.parentElement).toHaveStyle({ left: "70px", top: "25px" });
    expect(screen.getByText("dependency")).toBeInTheDocument();

    fireEvent.click(link);
    expect(onLinkActivate).toHaveBeenCalledWith(expect.anything(), "https://example.com");
  });

  it("makes the entire aggregate label shape the focus button, not the edge path", () => {
    const onActivate = vi.fn();
    render(
      <RouteEdge
        data={{
          path: "M 0 0 L 100 100",
          labelPosition: { x: 50, y: 50 },
          eyebrow: "×2",
          labelAction: { ariaLabel: "Show 2 edges", onActivate },
        }}
        id="aggregate"
        source="source"
        sourcePosition={Position.Right}
        sourceX={0}
        sourceY={0}
        target="target"
        targetPosition={Position.Left}
        targetX={100}
        targetY={100}
        type="route"
      />,
    );

    const label = screen.getByRole("button", { name: "Show 2 edges" });
    expect(label).toHaveClass("rounded-md", "border", "px-2", "py-1", "cursor-pointer");
    expect(label).toHaveStyle({ left: "50px", top: "50px" });
    expect(label).toContainElement(screen.getByText("×2"));
    fireEvent.click(screen.getByTestId("edge-path"));
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(label);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("renders a label control at its anchor with full opacity", () => {
    const control = <button type="button">Render path</button>;
    render(
      <RouteEdge
        data={{
          path: "M 0 0 L 100 100",
          labelPosition: { x: 50, y: 50 },
          labelControls: [{ control, position: { x: 20, y: 10 } }],
        }}
        id="fork"
        source="source"
        sourcePosition={Position.Right}
        sourceX={0}
        sourceY={0}
        style={{ opacity: 0.25 }}
        target="target"
        targetPosition={Position.Left}
        targetX={100}
        targetY={100}
        type="route"
      />,
    );

    const host = screen.getByRole("button", { name: "Render path" }).parentElement!;
    expect(host).toHaveStyle({ left: "20px", top: "10px", opacity: "1" });
  });

  it("renders several label controls at their own anchors", () => {
    render(
      <RouteEdge
        data={{
          path: "M 0 0 L 100 100",
          labelPosition: { x: 50, y: 50 },
          labelControls: [
            { control: <button type="button">Branch</button>, position: { x: 10, y: 0 } },
            { control: <button type="button">Conditional</button>, position: { x: 90, y: 100 } },
          ],
        }}
        id="guards"
        source="source"
        sourcePosition={Position.Right}
        sourceX={0}
        sourceY={0}
        target="target"
        targetPosition={Position.Left}
        targetX={100}
        targetY={100}
        type="route"
      />,
    );

    expect(screen.getByRole("button", { name: "Branch" }).parentElement).toHaveStyle({ left: "10px", top: "0px" });
    expect(screen.getByRole("button", { name: "Conditional" }).parentElement).toHaveStyle({
      left: "90px",
      top: "100px",
    });
  });

  it("does not render an empty path", () => {
    const { container } = render(
      <RouteEdge
        data={{ path: "", labelPosition: { x: 0, y: 0 } }}
        id="edge"
        source="source"
        sourcePosition={Position.Right}
        sourceX={0}
        sourceY={0}
        target="target"
        targetPosition={Position.Left}
        targetX={0}
        targetY={0}
        type="route"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
