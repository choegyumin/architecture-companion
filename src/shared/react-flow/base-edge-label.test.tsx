import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseEdgeLabel } from "@/shared/react-flow/base-edge-label";

describe("edge label", () => {
  it("renders an anchor and fires the activation callback when a link exists", () => {
    const onActivate = vi.fn();
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
