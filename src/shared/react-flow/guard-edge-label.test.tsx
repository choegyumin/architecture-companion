import { render, screen, within } from "@testing-library/react";

import { GuardEdgeLabel, type GuardPill } from "@/shared/react-flow/guard-edge-label";

const pill = (overrides: Partial<GuardPill> & Pick<GuardPill, "kind" | "label">): GuardPill => ({
  id: `${overrides.kind}:${overrides.label}`,
  pressed: false,
  active: true,
  description: "Active path",
  onSelect: () => {},
  ...overrides,
});

describe("guard edge label", () => {
  it("wraps an AND clause of several pills in one shared box", () => {
    render(
      <GuardEdgeLabel
        clauses={[
          [pill({ kind: "conditional", label: "flag" }), pill({ kind: "conditional", label: "busy", pressed: true })],
        ]}
      />,
    );

    const box = screen.getAllByRole("button").at(0)!.parentElement!;
    expect(box).toHaveClass("bg-muted/60");
    const [flag, busy] = within(box).getAllByRole("button");
    expect(flag?.firstElementChild).toHaveClass("lucide-check", "opacity-25");
    expect(busy?.firstElementChild).toHaveClass("lucide-check");
  });

  it("renders lone clauses bare and keeps OR clauses side by side", () => {
    const { container } = render(
      <GuardEdgeLabel
        clauses={[[pill({ kind: "branch", label: "On" })], [pill({ kind: "branch", label: "Off", pressed: true })]]}
      />,
    );

    const boxes = [...container.querySelectorAll(".bg-muted\\/60")];
    expect(boxes).toHaveLength(0);
    const [on, off] = screen.getAllByRole("button");
    expect(on?.firstElementChild).toHaveClass("lucide-split", "opacity-25");
    expect(off?.firstElementChild).toHaveClass("lucide-split");
  });

  it("keeps the pill itself as the pressed button and hides the icons from assistive tech", () => {
    render(<GuardEdgeLabel clauses={[[pill({ kind: "branch", label: "On", pressed: true })]]} />);

    const button = screen.getByRole("button", { name: "On", pressed: true });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
