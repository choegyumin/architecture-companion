import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GuardEdgeLabel } from "@/shared/react-flow/guard-edge-label";

function renderLabel(onHighlightChange = vi.fn()) {
  const onSelect = vi.fn();
  render(
    <GuardEdgeLabel
      active
      includesBranch={false}
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

describe("guard edge label", () => {
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
