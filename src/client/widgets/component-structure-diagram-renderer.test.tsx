import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { installComponentDiagramBrowserMeasurements } from "@/client/widgets/component-structure-test-browser";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { Artifact } from "@/features/artifact/artifact";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type { DefaultDiagramEdge, DiagramGraph } from "@/features/diagram/diagram-graph";

import { waitForDiagramReady } from "../../../tests/helpers/wait-for-diagram";

const annotations = {
  document: { annotations: [] },
  surface: { canvasId: "components" },
  isCommentMode: false,
  isManaging: false,
  isPublishing: false,
  begin: () => {},
  change: () => {},
  changeEdit: () => {},
  cancel: async () => true,
  closeEdit: async () => true,
  move: async () => {},
  open: () => {},
  publish: async () => {},
  removeEdit: async () => {},
  resolveEditConflict: async () => {},
  saveEdit: async () => true,
} satisfies AnnotationCanvasController;

const diagram = {
  id: "components",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Component structure",
  generator: "built-in:react-component-structure",
  instructions: "## Purpose\nExplore rendering paths.\n\n## Regeneration\nRead the component sources.",
  layout: { id: "elk-layered" },
  graph: projectDecisionNodes({
    groups: [],
    nodes: [
      { id: "app", type: "default", kind: "component", title: "App" },
      { id: "details", type: "default", kind: "component", title: "Details" },
    ],
    edges: [
      {
        id: "app-details",
        type: "default",
        source: "app",
        target: "details",
        activeWhen: [[{ controlId: "show-details", value: "on" }]],
      },
    ],
    roots: ["app"],
    controls: [{ id: "show-details", owner: "app", label: "showDetails", kind: "conditional", dependsOn: [[]] }],
  }),
} satisfies Artifact;

function branchGraph(edges: DiagramGraph["edges"]): DiagramGraph {
  const ids = [...new Set(["app", ...edges.flatMap((edge) => [edge.source, edge.target])])];
  return {
    groups: [],
    nodes: ids.map((id) => ({ id, type: "default", kind: "component", title: id })),
    edges,
    roots: ["app"],
    controls: [
      {
        id: "mode",
        owner: "app",
        label: "mode",
        kind: "branch",
        dependsOn: [[]],
        cases: [
          { id: "small", label: "Small" },
          { id: "large", label: "Large" },
        ],
      },
    ],
  };
}

function connection(id: string, source: string, target: string, alternative?: string): DefaultDiagramEdge {
  return {
    id,
    type: "default",
    source,
    target,
    activeWhen: alternative ? [[{ controlId: "mode", value: alternative }]] : [[]],
  };
}

function sharedGraph(): DiagramGraph {
  return {
    groups: [],
    nodes: ["app", "left", "right", "shared", "leaf", "extra"].map((id) => ({
      id,
      type: "default",
      kind: "component",
      title: id,
    })),
    edges: [
      { ...connection("a-left", "app", "left"), activeWhen: [[{ controlId: "left", value: "on" }]] },
      { ...connection("z-right", "app", "right"), activeWhen: [[{ controlId: "right", value: "on" }]] },
      connection("left-shared", "left", "shared"),
      connection("right-shared", "right", "shared"),
      connection("right-extra", "right", "extra"),
      { ...connection("shared-leaf", "shared", "leaf"), activeWhen: [[{ controlId: "leaf", value: "on" }]] },
    ],
    roots: ["app"],
    controls: [
      { id: "left", owner: "app", label: "left", kind: "conditional", dependsOn: [[]] },
      { id: "right", owner: "app", label: "right", kind: "conditional", dependsOn: [[]] },
      { id: "leaf", owner: "shared", label: "leaf", kind: "conditional", dependsOn: [[]] },
    ],
  };
}

let restoreBrowserMeasurements: () => void;
beforeEach(() => {
  restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
});
afterEach(() => restoreBrowserMeasurements());

describe("component structure paths", () => {
  it("initially selects the branch with more unique descendants", async () => {
    const graph = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("small-same-first", "small", "same"),
      connection("small-same-second", "small", "same"),
      connection("z-large", "app", "large", "large"),
      connection("large-one", "large", "one"),
      connection("large-two", "large", "two"),
    ]);
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Small" })).toHaveAttribute("aria-pressed", "false");
  });
  it("ranks branch content reached through another visible source and a when-only prerequisite", async () => {
    const base = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("app-shell", "app", "shell"),
      {
        ...connection("shell-large", "shell", "large"),
        activeWhen: [[{ controlId: "details", value: "on" }]],
      },
      connection("large-one", "large", "one"),
      connection("one-two", "one", "two"),
    ]);
    const graph: DiagramGraph = {
      ...base,
      controls: [
        ...base.controls!,
        {
          id: "details",
          owner: "app",
          kind: "conditional",
          label: "details",
          dependsOn: [[{ controlId: "mode", value: "large" }]],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    // The chosen case guards project onto every edge naming it.
    expect(
      screen
        .getAllByRole("button", { name: "Large" })
        .every((button) => button.getAttribute("aria-pressed") === "true"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "details" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: large" })).toHaveAccessibleDescription("Inactive path");
  });

  it("excludes the opposite alternative's output from initial branch ranking", async () => {
    const graph = branchGraph([
      connection("z-small", "app", "shared", "small"),
      connection("a-large", "app", "large", "large"),
      connection("shared-tail", "shared", "tail", "small"),
    ]);
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    // Ranking the small arm counts shared and tail; the large arm counts only
    // large, so Small wins and its descendants light up. The chosen case
    // projects onto every edge naming it.
    expect(
      screen
        .getAllByRole("button", { name: "Small" })
        .every((button) => button.getAttribute("aria-pressed") === "true"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: tail" })).toHaveAccessibleDescription("Active path");
  });

  it("breaks descendant ties by the longest finite depth, without counting recursive cycles as depth", async () => {
    const graph = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("small-one", "small", "one"),
      connection("one-two", "one", "two"),
      connection("two-one", "two", "one"),
      connection("z-large", "app", "large", "large"),
      connection("large-three", "large", "three"),
      connection("three-four", "three", "four"),
    ]);
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
  });

  it("breaks equal descendant and depth ties by edge ID code-point order", async () => {
    const graph = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("Z-large", "app", "large", "large"),
    ]);
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
  });

  it("activates only the richer diverging ancestor route for an unreachable shared node", async () => {
    const graph = sharedGraph();
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "leaf" }));

    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "left" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: shared" })).toHaveAccessibleDescription("Active path");
  });

  it("breaks shared ancestor-route descendant ties by depth at the diverging branches", async () => {
    const base = sharedGraph();
    const graph: DiagramGraph = {
      ...base,
      nodes: [...base.nodes, { id: "left-extra", type: "default", kind: "component", title: "LeftExtra" }],
      edges: [
        ...base.edges,
        connection("left-extra", "left", "left-extra"),
        connection("extra-shared", "extra", "shared"),
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "leaf" }));

    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "left" })).toHaveAttribute("aria-pressed", "false");
  });

  it("breaks equal shared ancestor-route sizes and depths by divergent edge ID code-point order", async () => {
    const base = sharedGraph();
    const graph: DiagramGraph = {
      ...base,
      edges: base.edges
        .filter((edge) => edge.id !== "right-extra")
        .map((edge) => (edge.id === "z-right" ? { ...edge, id: "Z-right" } : edge)),
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "leaf" }));

    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "left" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps an already active ancestor route instead of enabling a richer route", async () => {
    const graph = sharedGraph();
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    await userEvent.click(screen.getByRole("button", { name: "left" }));

    await userEvent.click(screen.getByRole("button", { name: "leaf" }));

    expect(screen.getByRole("button", { name: "left" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: leaf" })).toHaveAccessibleDescription("Active path");
  });

  it("chooses fewer selection changes before comparing diverging branch sizes", async () => {
    const base = sharedGraph();
    const graph: DiagramGraph = {
      ...base,
      edges: base.edges.map((edge) =>
        edge.id === "z-right"
          ? {
              ...edge,
              type: "default",
              activeWhen: [
                [
                  { controlId: "right", value: "on" },
                  { controlId: "extra-gate", value: "on" },
                ],
              ],
            }
          : edge,
      ),
      controls: [
        ...base.controls!,
        {
          id: "extra-gate",
          owner: "app",
          label: "extraGate",
          kind: "conditional",
          dependsOn: [[{ controlId: "right", value: "on" }]],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "leaf" }));

    expect(screen.getByRole("button", { name: "left" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "extraGate" })).toHaveAttribute("aria-pressed", "false");
  });

  it("activates same-card prerequisites when the user chooses an already selected inactive branch", async () => {
    const branch = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("z-large", "app", "large", "large"),
      connection("large-child", "large", "child"),
    ]);
    const graph: DiagramGraph = {
      ...branch,
      edges: branch.edges.map((edge) =>
        edge.type === "default" && edge.source === "app"
          ? {
              ...edge,
              activeWhen: edge.activeWhen!.map((path) => [{ controlId: "show-mode", value: "on" }, ...path]),
            }
          : edge,
      ),
      roots: ["app"],
      controls: [
        { id: "show-mode", owner: "app", label: "showMode", kind: "conditional", dependsOn: [[]] },
        { ...branch.controls!.at(0)!, dependsOn: [[{ controlId: "show-mode", value: "on" }]] },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Large" }));

    expect(screen.getByRole("button", { name: "showMode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: large" })).toHaveAccessibleDescription("Active path");
  });

  it("treats a branch alternative named off as a selection, not a conditional switch-off", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "plain", "preview"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        {
          ...connection("a-plain", "app", "plain"),
          activeWhen: [
            [
              { controlId: "parent", value: "on" },
              { controlId: "view", value: "off" },
            ],
          ],
        },
        {
          ...connection("z-preview", "app", "preview"),
          activeWhen: [
            [
              { controlId: "parent", value: "on" },
              { controlId: "view", value: "on" },
            ],
          ],
        },
      ],
      roots: ["app"],
      controls: [
        { id: "parent", owner: "app", label: "showPage", kind: "conditional", dependsOn: [[]] },
        {
          id: "view",
          owner: "app",
          label: "view",
          kind: "branch",
          dependsOn: [[{ controlId: "parent", value: "on" }]],
          cases: [
            { id: "off", label: "No preview" },
            { id: "on", label: "Preview" },
          ],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "No preview" }));

    expect(screen.getByRole("button", { name: "showPage" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Active path");
  });

  it("reroutes an unrelated gating choice to reach a root-owned control's dead arm", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "small", "large", "empty"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        connection("a-small", "app", "small", "small"),
        connection("a-large", "app", "large", "large"),
        {
          id: "large-empty",
          type: "default",
          source: "large",
          target: "empty",
          activeWhen: [
            [
              { controlId: "mode", value: "large" },
              { controlId: "fallback", value: "no" },
            ],
          ],
        },
      ],
      roots: ["app"],
      controls: [
        {
          id: "mode",
          owner: "app",
          label: "mode",
          kind: "branch",
          dependsOn: [[]],
          cases: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
        {
          id: "fallback",
          owner: "large",
          label: "fallback",
          kind: "branch",
          dependsOn: [[]],
          cases: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    await userEvent.click(screen.getByRole("button", { name: "Small" }));

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    const largePills = screen.getAllByRole("button", { name: "Large" });
    expect(largePills.every((pill) => pill.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(screen.getByRole("img", { name: "fallback" })).toHaveAccessibleDescription("Active path");
    expect(screen.getByRole("article", { name: "Non-component" })).toHaveAccessibleDescription("Active path");
  });

  it("dims an inactive connection and its label even when both endpoint cards are active", async () => {
    const graph: DiagramGraph = {
      ...diagram.graph,
      edges: [{ ...diagram.graph.edges.at(0)!, label: "optional" }, connection("always", "app", "details")],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    expect(screen.getByRole("article", { name: "component: Details" })).toHaveAccessibleDescription("Active path");
    const inactive = screen.getByRole("img", { name: "app to details: Inactive path" });
    expect(inactive).toBeVisible();
    expect(inactive.querySelector("path")).toHaveAttribute("style", expect.stringContaining("opacity: 0.25"));
  });

  it("preserves a child selection while its parent is off and restores its effective path without moving connections", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "panel", "details"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        { ...connection("app-panel", "app", "panel"), activeWhen: [[{ controlId: "panel", value: "on" }]] },
        {
          ...connection("panel-details", "panel", "details"),
          activeWhen: [[{ controlId: "details", value: "on" }]],
        },
      ],
      roots: ["app"],
      controls: [
        { id: "panel", owner: "app", label: "showPanel", kind: "conditional", dependsOn: [[]] },
        { id: "details", owner: "panel", label: "showDetails", kind: "conditional", dependsOn: [[]] },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    const route = screen
      .getByRole("img", { name: "panel to details: Inactive path" })
      .querySelector("path")!
      .getAttribute("d");

    await userEvent.click(screen.getByRole("button", { name: "showDetails" }));
    await userEvent.click(screen.getByRole("button", { name: "showPanel" }));

    expect(screen.getByRole("button", { name: "showDetails" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: details" })).toHaveAccessibleDescription("Inactive path");
    await userEvent.click(screen.getByRole("button", { name: "showPanel" }));
    expect(screen.getByRole("article", { name: "component: details" })).toHaveAccessibleDescription("Active path");
    expect(screen.getByRole("img", { name: "panel to details: Active path" }).querySelector("path")).toHaveAttribute(
      "d",
      route,
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);
    // Two connections; conditional guards attach chips without fork trunks.
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("turns an inactive child off without activating its ancestors", async () => {
    const graph: DiagramGraph = {
      ...branchGraph([
        connection("a-small", "app", "small", "small"),
        connection("z-large", "app", "large", "large"),
        {
          ...connection("small-leaf", "small", "leaf"),
          activeWhen: [[{ controlId: "show-leaf", value: "on" }]],
        },
        connection("large-one", "large", "one"),
        connection("one-two", "one", "two"),
      ]),
    };
    graph.controls = [
      ...graph.controls!,
      { id: "show-leaf", owner: "small", label: "showLeaf", kind: "conditional", dependsOn: [[]] },
    ];
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "showLeaf" }));
    await userEvent.click(screen.getByRole("button", { name: "Large" }));
    await userEvent.click(screen.getByRole("button", { name: "showLeaf" }));

    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "showLeaf" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: small" })).toHaveAccessibleDescription("Inactive path");
  });

  it("keeps branch selections local to each displayed component diagram", async () => {
    const graph = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("z-large", "app", "large", "large"),
    ]);
    render(
      <>
        <DiagramRenderer
          ariaLabel="First composition"
          annotations={annotations}
          diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
          onOpenSource={() => {}}
        />
        <DiagramRenderer
          ariaLabel="Second composition"
          annotations={annotations}
          diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
          onOpenSource={() => {}}
        />
      </>,
    );
    await waitForDiagramReady();
    const first = within(screen.getByRole("region", { name: "First composition" }));
    const second = within(screen.getByRole("region", { name: "Second composition" }));

    await userEvent.click(first.getByRole("button", { name: "Small" }));

    expect(first.getByRole("button", { name: "Small" })).toHaveAttribute("aria-pressed", "true");
    expect(second.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
    expect(second.getByRole("article", { name: "component: large" })).toHaveAccessibleDescription("Active path");
  });

  it("retains the component title and displays every supplier-prop pair of a merged node", async () => {
    const graph: DiagramGraph = {
      ...diagram.graph,
      nodes: [
        { id: "app", type: "default", kind: "component", title: "App" },
        {
          id: "details",
          type: "default",
          kind: "component",
          title: "Details",
          component: {
            definitionId: "src/details.tsx:Details",
            origins: [
              { supplierId: "app", supplierTitle: "Page", prop: "footer" },
              { supplierId: "app", supplierTitle: "Modal", prop: "children" },
              { supplierId: "app", supplierTitle: "Page", prop: "header" },
            ],
          },
        },
      ],
      edges: [
        {
          id: "page-details-footer",
          type: "default",
          source: "app",
          target: "details",
          label: "from Page",
          kind: "NODE (footer)",
        },
        {
          id: "modal-details-children",
          type: "default",
          source: "app",
          target: "details",
          label: "from Modal",
          kind: "NODE (children)",
        },
        {
          id: "page-details-header",
          type: "default",
          source: "app",
          target: "details",
          label: "from Page",
          kind: "NODE (header)",
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    const card = screen.getByRole("article", { name: "component: Details" });

    expect(within(card).getByRole("heading", { name: "Details" })).toBeVisible();
    const origins = within(within(card).getByRole("list"));
    expect(origins.getByText("from Page (footer node)")).toBeVisible();
    expect(origins.getByText("from Modal (children node)")).toBeVisible();
    expect(origins.getByText("from Page (header node)")).toBeVisible();
  });

  it("keeps path controls separate from node comment targeting", async () => {
    const begin = vi.fn();
    render(
      <DiagramRenderer
        annotations={{ ...annotations, isCommentMode: true, begin }}
        diagram={diagram}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "showDetails" }));
    expect(begin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("heading", { name: "App" }), { view: window });

    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: "components", target: { type: "node", id: "app" } }),
    );
  });

  it("reaches the owner of a when-only prerequisite while enabling a reachable shared consumer's control", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "supplier", "shared", "leaf"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        {
          ...connection("app-supplier", "app", "supplier"),
          activeWhen: [[{ controlId: "supplier-visible", value: "on" }]],
        },
        connection("app-shared", "app", "shared"),
        connection("supplier-shared", "supplier", "shared"),
        {
          ...connection("shared-leaf", "shared", "leaf"),
          activeWhen: [[{ controlId: "child", value: "on" }]],
        },
      ],
      roots: ["app"],
      controls: [
        { id: "supplier-visible", owner: "app", label: "supplier visible", kind: "conditional", dependsOn: [[]] },
        { id: "parent", owner: "supplier", label: "parent", kind: "conditional", dependsOn: [[]] },
        {
          id: "child",
          owner: "shared",
          label: "child",
          kind: "conditional",
          dependsOn: [[{ controlId: "parent", value: "on" }]],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("button", { name: "child" }));

    expect(screen.getByRole("button", { name: "supplier visible" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "parent" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: leaf" })).toHaveAccessibleDescription("Active path");
  });

  it("enables one minimum-change OR prerequisite route even when candidate owner routes have different lengths", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "supplier", "leaf"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        {
          ...connection("app-supplier", "app", "supplier"),
          activeWhen: [[{ controlId: "supplier-visible", value: "on" }]],
        },
        { ...connection("app-leaf", "app", "leaf"), activeWhen: [[{ controlId: "child", value: "on" }]] },
      ],
      roots: ["app"],
      controls: [
        { id: "supplier-visible", owner: "app", label: "supplier visible", kind: "conditional", dependsOn: [[]] },
        { id: "direct", owner: "app", label: "direct", kind: "conditional", dependsOn: [[]] },
        { id: "supplied", owner: "supplier", label: "supplied", kind: "conditional", dependsOn: [[]] },
        {
          id: "child",
          owner: "app",
          label: "child",
          kind: "conditional",
          dependsOn: [[{ controlId: "direct", value: "on" }], [{ controlId: "supplied", value: "on" }]],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    await userEvent.click(screen.getByRole("button", { name: "supplied" }));
    await userEvent.click(screen.getByRole("button", { name: "supplier visible" }));

    // "child" projects once per OR clause; either pill requests the same path.
    await userEvent.click(screen.getAllByRole("button", { name: "child" }).at(0)!);

    const direct = screen.getByRole("button", { name: "direct" });
    const supplier = screen.getByRole("button", { name: "supplier visible" });
    expect(
      Number(direct.getAttribute("aria-pressed") === "true") + Number(supplier.getAttribute("aria-pressed") === "true"),
    ).toBe(1);
    expect(screen.getByRole("article", { name: "component: leaf" })).toHaveAccessibleDescription("Active path");
  });

  it("honors transitive when-only prerequisites for branch emphasis and descendant activation", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "plain", "preview"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        { ...connection("a-plain", "app", "plain"), activeWhen: [[{ controlId: "view", value: "plain" }]] },
        {
          ...connection("z-preview", "app", "preview"),
          activeWhen: [[{ controlId: "view", value: "preview" }]],
        },
      ],
      roots: ["app"],
      controls: [
        { id: "grandparent", owner: "app", label: "grandparent", kind: "conditional", dependsOn: [[]] },
        {
          id: "parent",
          owner: "app",
          label: "parent",
          kind: "conditional",
          dependsOn: [[{ controlId: "grandparent", value: "on" }]],
        },
        {
          id: "view",
          owner: "app",
          label: "view",
          kind: "branch",
          dependsOn: [[{ controlId: "parent", value: "on" }]],
          cases: [
            { id: "plain", label: "Plain" },
            { id: "preview", label: "Preview" },
          ],
        },
      ],
    };
    render(
      <DiagramRenderer
        annotations={annotations}
        diagram={{ ...diagram, graph: projectDecisionNodes(graph) }}
        onOpenSource={() => {}}
      />,
    );
    await waitForDiagramReady();
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Inactive path");

    await userEvent.click(screen.getByRole("button", { name: "Plain" }));
    await userEvent.click(screen.getByRole("button", { name: "grandparent" }));

    // Releasing the prerequisite clause turns its conditions off as one unit.
    expect(screen.getByRole("button", { name: "parent" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Plain" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Inactive path");
    await userEvent.click(screen.getByRole("button", { name: "Plain" }));
    expect(screen.getByRole("button", { name: "grandparent" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Active path");
  });

  it("starts conditional paths off while keeping their controls and nodes visible", async () => {
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("button", { name: "showDetails" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("article", { name: "component: Details" })).toHaveAccessibleDescription("Inactive path");
    expect(screen.getByRole("article", { name: "component: App" })).toHaveAccessibleDescription("Active path");
  });
});
