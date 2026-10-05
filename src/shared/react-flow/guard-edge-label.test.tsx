import { render, screen } from "@testing-library/react";

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
  it("marks a branch pill with a leading split arrow that dims until selected", () => {
    const { container } = render(
      <GuardEdgeLabel
        pills={[pill({ kind: "branch", label: "On" }), pill({ kind: "branch", label: "Off", pressed: true })]}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const [on, off] = buttons;
    expect(on?.firstElementChild).toHaveClass("lucide-split", "opacity-25");
    expect(off?.firstElementChild).toHaveClass("lucide-split");
    expect(off?.firstElementChild).not.toHaveClass("opacity-25");
    expect(container.querySelectorAll("[data-icon=inline-start]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-icon=inline-end]")).toHaveLength(0);
  });

  it("marks a conditional pill with a leading check that dims until its condition holds", () => {
    const { container } = render(
      <GuardEdgeLabel
        pills={[
          pill({ kind: "conditional", label: "flag" }),
          pill({ kind: "conditional", label: "busy", pressed: true }),
        ]}
      />,
    );

    const buttons = screen.getAllByRole("button");
    const [flag, busy] = buttons;
    expect(flag?.firstElementChild).toHaveClass("lucide-check", "opacity-25");
    expect(busy?.firstElementChild).toHaveClass("lucide-check");
    expect(busy?.firstElementChild).not.toHaveClass("opacity-25");
    expect(container.querySelectorAll("[data-icon=inline-start]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-icon=inline-end]")).toHaveLength(0);
  });

  it("keeps the pill itself as the pressed button and hides the icons from assistive tech", () => {
    render(<GuardEdgeLabel pills={[pill({ kind: "branch", label: "On", pressed: true })]} />);

    const button = screen.getByRole("button", { name: "On", pressed: true });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
