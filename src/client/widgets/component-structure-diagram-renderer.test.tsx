import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { vi } from "vitest";

import { isComponentStructureArtifact, parseArtifact } from "@/features/artifact/artifact";
import { calculateConditionPolarityPair } from "@/features/diagram/control-polarity";
import { projectDecisionNodes, projectedComponentStructureNodeId } from "@/features/diagram/decision-nodes";

import { ComponentStructureDiagramRenderer } from "./component-structure-diagram-renderer";
import type { DiagramRendererBase } from "./diagram-renderer-base";

// Replace only canvas measurement/layout. Owner fields and selection use the
// actual renderer, projection, node builders, and switches.
vi.mock("./diagram-renderer-base", () => ({
  DiagramRendererBase: ({ artifact, buildRenderModel, onOpenSource }: ComponentProps<typeof DiagramRendererBase>) => {
    if (!isComponentStructureArtifact(artifact)) throw new Error("Expected component structure");
    const graph = projectDecisionNodes(artifact.diagram.graph);
    const model = buildRenderModel(
      artifact,
      {
        nodes: graph.nodes.map((node) => ({
          id: projectedComponentStructureNodeId(node),
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 },
        })),
        edges: [],
        groups: [],
        initialView: { mode: "fit" },
      },
      onOpenSource,
    );
    return model.nodes.map((node) =>
      node.type === "card" ? (
        <section key={node.id} data-testid={node.id} data-active={node.data.accessibleDescription !== "Inactive path"}>
          {node.data.children}
        </section>
      ) : null,
    );
  },
}));

function renderGate(polarityPair: true | undefined) {
  const document = parseArtifact({
    type: "design",
    title: "Polarity",
    generator: "built-in:freeform",
    updatedAt: "2026-10-12T00:00:00.000Z",
    instructions: "Review a source-negated gate whose false case is ON.",
    diagram: {
      layout: { layoutId: "component-structure" },
      graph: {
        groups: [],
        nodes: ["root", "yes", "no"].map((id) => ({ nodeId: id, type: "default", title: id })),
        edges: [
          {
            edgeId: "yes",
            type: "control",
            sourceNodeId: "root",
            targetNodeId: "yes",
            activeWhen: [[{ controlId: "gate", value: "false" }]],
          },
          {
            edgeId: "no",
            type: "control",
            sourceNodeId: "root",
            targetNodeId: "no",
            activeWhen: [[{ controlId: "gate", value: "true" }]],
          },
        ],
        layoutContext: {
          rootNodeIds: ["root"],
          controls: [
            {
              controlId: "gate",
              ownerNodeId: "root",
              type: "branch",
              dependsOn: [[]],
              ...calculateConditionPolarityPair("!ready"),
              polarityPair,
            },
          ],
        },
      },
    },
  });
  const artifact = { ...document, artifactId: ".architecture-companion/artifacts/polarity.archcomp.json" };
  return render(
    <ComponentStructureDiagramRenderer
      artifact={artifact}
      onOpenSource={vi.fn()}
      annotations={{} as ComponentProps<typeof ComponentStructureDiagramRenderer>["annotations"]}
    />,
  );
}

describe("component owner polarity switches", () => {
  it("checks and toggles the normalized ON case even when its source ID is false", async () => {
    const user = userEvent.setup();
    renderGate(true);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();
    expect(screen.getByTestId("yes")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("no")).toHaveAttribute("data-active", "false");

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("yes")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("no")).toHaveAttribute("data-active", "true");

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByTestId("yes")).toHaveAttribute("data-active", "true");
  });

  it("keeps a two-case branch without the polarity marker as a select", () => {
    renderGate(undefined);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ready" })).toBeInTheDocument();
  });
});
