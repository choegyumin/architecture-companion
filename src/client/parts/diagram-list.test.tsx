import { render, screen, within } from "@testing-library/react";

import { DiagramList } from "@/client/parts/diagram-list";
import type { Diagram } from "@/features/diagram/diagram";

function createDiagram(id: string, title: string): Diagram {
  return {
    id,
    title,
    generatorId: "freeform",
    layout: { id: "elk-layered" },
    graph: {
      groups: [],
      nodes: [{ type: "default", id: `${id}-node`, kind: "step", title: `${title} step` }],
      edges: [],
    },
  };
}

describe("diagram list", () => {
  it("shows diagrams in the given order and highlights the active item", () => {
    render(
      <DiagramList
        activeDiagramId="checkout"
        diagrams={[
          createDiagram("checkout", "Checkout"),
          createDiagram("account", "Account"),
          createDiagram("billing", "Billing"),
        ]}
        heading="Designs"
        onSelect={() => undefined}
      />,
    );

    const diagramButtons = within(screen.getByRole("list", { name: "Designs" })).getAllByRole("button");
    expect(diagramButtons.map((button) => button.textContent)).toEqual(["Checkout", "Account", "Billing"]);
    expect(diagramButtons.at(0)).toHaveAttribute("aria-current", "page");
    expect(diagramButtons.at(1)).not.toHaveAttribute("aria-current");
  });
});
