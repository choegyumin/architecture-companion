import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseEdgeLabel } from "@/shared/react-flow/base-edge-label";

describe("edge label", () => {
  it("renders an anchor and fires the activation callback when a link exists", () => {
    const onActivate = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<BaseEdgeLabel href="source:///src/example.ts" onActivate={onActivate} text="Open source" />);
    const link = screen.getByRole("link", { name: "Open source" });

    expect(link).toHaveAttribute("href", "source:///src/example.ts");
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(link);
    expect(onActivate).toHaveBeenCalledWith(expect.any(Object), "source:///src/example.ts");
  });

  it("renders the label as plain text when there is no link", () => {
    render(<BaseEdgeLabel text="Uses" />);

    expect(screen.getByText("Uses").tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

function renderLabel(onHighlightChange = vi.fn()) {
  const onSelect = vi.fn();
  render(
    <BaseEdgeLabel
      active
      ariaLabel="Route condition: view = preview"
      icon={<svg aria-hidden="true" />}
      onHighlightChange={onHighlightChange}
      onSelect={onSelect}
      text="view = preview"
    />,
  );
  return {
    label: screen.getByRole("button", { name: "Route condition: view = preview" }),
    onHighlightChange,
    onSelect,
  };
}

describe("selectable edge label", () => {
  it("dims the supplied icon for an inactive label without disabling selection", () => {
    const onSelect = vi.fn();
    render(
      <BaseEdgeLabel
        active={false}
        ariaLabel="Choose preview"
        icon={<svg data-testid="label-icon" />}
        onSelect={onSelect}
        text="Preview"
      />,
    );
    const button = screen.getByRole("button", { name: "Choose preview" });
    expect(screen.getByTestId("label-icon").parentElement).toHaveClass("opacity-25");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("reports highlight for pointer entry and focus, and clears on leave and blur", () => {
    const { label, onHighlightChange } = renderLabel();

    fireEvent.mouseEnter(label);
    fireEvent.focus(label);
    fireEvent.mouseLeave(label);
    fireEvent.blur(label);

    expect(onHighlightChange.mock.calls).toEqual([[true], [true], [false], [false]]);
  });

  it("applies the route rule on click without reporting a highlight", () => {
    const { label, onSelect, onHighlightChange } = renderLabel();

    fireEvent.click(label);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onHighlightChange).not.toHaveBeenCalled();
  });
});
