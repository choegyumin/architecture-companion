import { render, screen, within } from "@testing-library/react";

import { GuardEdgeLabel, type GuardPill } from "@/shared/react-flow/guard-edge-label";

const pill = (overrides: Partial<GuardPill> & Pick<GuardPill, "kind" | "label">): GuardPill => ({
  id: `${overrides.kind}:${overrides.label}`,
  pressed: false,
  onSelect: () => {},
  ...overrides,
});

describe("guard edge label", () => {
  it("wraps an AND rule of several pills in one shared box", () => {
    render(
      <GuardEdgeLabel
        rules={[
          [pill({ kind: "conditional", label: "flag" }), pill({ kind: "conditional", label: "busy", pressed: true })],
        ]}
      />,
    );

    const box = screen.getAllByRole("button").at(0)!.parentElement!;
    // Only some requirements hold, so the box reads as indeterminate.
    expect(box).toHaveClass("border-dashed", "bg-muted/60");
    const [flag, busy] = within(box).getAllByRole("button");
    expect(flag?.firstElementChild).toHaveClass("lucide-check", "opacity-25");
    expect(busy?.firstElementChild).toHaveClass("lucide-check");
  });

  it("tints the rule box when every requirement holds", () => {
    render(
      <GuardEdgeLabel
        rules={[
          [
            pill({ kind: "conditional", label: "flag", pressed: true }),
            pill({ kind: "branch", label: "On", pressed: true }),
          ],
        ]}
      />,
    );

    expect(screen.getAllByRole("button").at(0)!.parentElement).toHaveClass("border-primary/40", "bg-primary/10");
  });

  it("keeps the rule box plain when no requirement holds", () => {
    render(
      <GuardEdgeLabel
        rules={[[pill({ kind: "conditional", label: "flag" }), pill({ kind: "branch", label: "On" })]]}
      />,
    );

    expect(screen.getAllByRole("button").at(0)!.parentElement).toHaveClass("border-transparent", "bg-muted/60");
  });

  it("renders lone rules bare and keeps OR rules side by side", () => {
    const { container } = render(
      <GuardEdgeLabel
        rules={[[pill({ kind: "branch", label: "On" })], [pill({ kind: "branch", label: "Off", pressed: true })]]}
      />,
    );

    const boxes = [...container.querySelectorAll(".bg-muted\\/60")];
    expect(boxes).toHaveLength(0);
    const [on, off] = screen.getAllByRole("button");
    expect(on?.firstElementChild).toHaveClass("lucide-split", "opacity-25");
    expect(off?.firstElementChild).toHaveClass("lucide-split");
  });

  it("keeps the pill itself as the pressed button and hides the icons from assistive tech", () => {
    render(<GuardEdgeLabel rules={[[pill({ kind: "branch", label: "On", pressed: true })]]} />);

    const button = screen.getByRole("button", { name: "On", pressed: true });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
