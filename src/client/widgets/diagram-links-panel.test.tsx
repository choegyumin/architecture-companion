import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { DiagramLinksPanel } from "@/client/widgets/diagram-links-panel";

vi.mock("@xyflow/react", () => ({
  Panel: ({ children, className, position }: { children: ReactNode; className?: string; position: string }) => (
    <div className={className} data-position={position} data-testid="diagram-links-panel">
      {children}
    </div>
  ),
}));

describe("diagram links panel", () => {
  it("renders nothing when there are no links", () => {
    const { container } = render(<DiagramLinksPanel links={[]} onOpenSource={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows source link names and requests opening the source", () => {
    const onOpenSource = vi.fn();
    render(
      <DiagramLinksPanel
        links={[
          { href: "source:///specs/user-review-architecture.spec.tsx" },
          { text: "User Journey Test", href: "source:///specs/other.spec.tsx" },
        ]}
        onOpenSource={onOpenSource}
      />,
    );

    expect(screen.getByTestId("diagram-links-panel")).toHaveAttribute("data-position", "bottom-right");
    const inferredLabelLink = screen.getByRole("button", { name: "Open user-review-architecture.spec.tsx" });
    expect(screen.getByRole("button", { name: "Open User Journey Test" })).toBeInTheDocument();
    fireEvent.click(inferredLabelLink);

    expect(onOpenSource).toHaveBeenCalledWith("source:///specs/user-review-architecture.spec.tsx");
  });

  it("keeps external links as new-tab links", () => {
    const onOpenSource = vi.fn();
    render(<DiagramLinksPanel links={[{ href: "https://example.com/docs" }]} onOpenSource={onOpenSource} />);

    const link = screen.getByRole("button", { name: "Open https://example.com/docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    fireEvent.click(link);

    expect(onOpenSource).not.toHaveBeenCalled();
  });
});
