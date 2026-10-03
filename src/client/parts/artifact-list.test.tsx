import { render, screen, within } from "@testing-library/react";

import { ArtifactList } from "@/client/parts/artifact-list";
import type { Artifact } from "@/features/artifact/artifact";

function createDiagram(id: string, title: string): Artifact {
  return {
    id,
    updatedAt: "2026-10-03T09:15:00.000Z",
    title,
    generator: "built-in:freeform",
    instructions: `## Purpose\nReview ${title}.\n\n## Regeneration\nRebuild the ${id} workflow.`,
    layout: { id: "elk-layered" },
    graph: {
      groups: [],
      nodes: [{ type: "default", id: `${id}-node`, kind: "step", title: `${title} step` }],
      edges: [],
    },
  };
}

describe("artifact list", () => {
  it("shows artifacts in the given order and highlights the active item", () => {
    render(
      <ArtifactList
        activeArtifactId="checkout"
        artifacts={[
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
