import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { installComponentDiagramBrowserMeasurements } from "@/client/widgets/component-structure-test-browser";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { Diagram } from "@/features/diagram/diagram";
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
  graph: {
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
        component: { paths: [[{ controlId: "show-details", value: "on" }]] },
      },
    ],
    componentStructure: {
      roots: ["app"],
      controls: [{ id: "show-details", source: "app", label: "showDetails", kind: "conditional", when: [[]] }],
    },
  },
} satisfies Diagram;

function branchGraph(edges: DiagramGraph["edges"]): DiagramGraph {
  const ids = [...new Set(["app", ...edges.flatMap((edge) => [edge.source, edge.target])])];
  return {
    groups: [],
    nodes: ids.map((id) => ({ id, type: "default", kind: "component", title: id })),
    edges,
    componentStructure: {
      roots: ["app"],
      controls: [
        {
          id: "mode",
          source: "app",
          label: "mode",
          kind: "branch",
          when: [[]],
          alternatives: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    },
  };
}

function connection(id: string, source: string, target: string, alternative?: string): DefaultDiagramEdge {
  return {
    id,
    type: "default",
    source,
    target,
    component: { paths: alternative ? [[{ controlId: "mode", value: alternative }]] : [[]] },
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
      { ...connection("a-left", "app", "left"), component: { paths: [[{ controlId: "left", value: "on" }]] } },
      { ...connection("z-right", "app", "right"), component: { paths: [[{ controlId: "right", value: "on" }]] } },
      connection("left-shared", "left", "shared"),
      connection("right-shared", "right", "shared"),
      connection("right-extra", "right", "extra"),
      { ...connection("shared-leaf", "shared", "leaf"), component: { paths: [[{ controlId: "leaf", value: "on" }]] } },
    ],
    componentStructure: {
      roots: ["app"],
      controls: [
        { id: "left", source: "app", label: "left", kind: "conditional", when: [[]] },
        { id: "right", source: "app", label: "right", kind: "conditional", when: [[]] },
        { id: "leaf", source: "shared", label: "leaf", kind: "conditional", when: [[]] },
      ],
    },
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
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Small" })).not.toBeChecked();
  });
  it("ranks branch content reached through another visible source and a when-only prerequisite", async () => {
    const base = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("app-shell", "app", "shell"),
      {
        ...connection("shell-large", "shell", "large"),
        component: { paths: [[{ controlId: "details", value: "on" }]] },
      },
      connection("large-one", "large", "one"),
      connection("one-two", "one", "two"),
    ]);
    const graph: DiagramGraph = {
      ...base,
      componentStructure: {
        ...base.componentStructure!,
        controls: [
          ...base.componentStructure!.controls,
          {
            id: "details",
            source: "app",
            kind: "conditional",
            label: "details",
            when: [[{ controlId: "mode", value: "large" }]],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "details" })).not.toBeChecked();
    expect(screen.getByRole("article", { name: "component: large" })).toHaveAccessibleDescription("Inactive path");
  });

  it("excludes unreachable and opposite-alternative output from initial branch ranking", async () => {
    const graph = branchGraph([
      connection("z-small", "app", "shared", "small"),
      connection("a-large", "app", "large", "large"),
      connection("shared-tail", "shared", "tail", "large"),
    ]);
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: tail" })).toHaveAccessibleDescription("Inactive path");
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
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
  });

  it("breaks equal descendant and depth ties by edge ID code-point order", async () => {
    const graph = branchGraph([
      connection("a-small", "app", "small", "small"),
      connection("Z-large", "app", "large", "large"),
    ]);
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
  });

  it("activates only the richer diverging ancestor route for an unreachable shared node", async () => {
    const graph = sharedGraph();
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "leaf" }));

    expect(screen.getByRole("switch", { name: "right" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "left" })).not.toBeChecked();
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
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "leaf" }));

    expect(screen.getByRole("switch", { name: "right" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "left" })).not.toBeChecked();
  });

  it("breaks equal shared ancestor-route sizes and depths by divergent edge ID code-point order", async () => {
    const base = sharedGraph();
    const graph: DiagramGraph = {
      ...base,
      edges: base.edges
        .filter((edge) => edge.id !== "right-extra")
        .map((edge) => (edge.id === "z-right" ? { ...edge, id: "Z-right" } : edge)),
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "leaf" }));

    expect(screen.getByRole("switch", { name: "right" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "left" })).not.toBeChecked();
  });

  it("keeps an already active ancestor route instead of enabling a richer route", async () => {
    const graph = sharedGraph();
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await userEvent.click(screen.getByRole("switch", { name: "left" }));

    await userEvent.click(screen.getByRole("switch", { name: "leaf" }));

    expect(screen.getByRole("switch", { name: "left" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "right" })).not.toBeChecked();
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
              component: {
                paths: [
                  [
                    { controlId: "right", value: "on" },
                    { controlId: "extra-gate", value: "on" },
                  ],
                ],
              },
            }
          : edge,
      ),
      componentStructure: {
        ...base.componentStructure!,
        controls: [
          ...base.componentStructure!.controls,
          {
            id: "extra-gate",
            source: "app",
            label: "extraGate",
            kind: "conditional",
            when: [[{ controlId: "right", value: "on" }]],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "leaf" }));

    expect(screen.getByRole("switch", { name: "left" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "right" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "extraGate" })).not.toBeChecked();
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
              component: {
                paths: edge.component!.paths.map((path) => [{ controlId: "show-mode", value: "on" }, ...path]),
              },
            }
          : edge,
      ),
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "show-mode", source: "app", label: "showMode", kind: "conditional", when: [[]] },
          { ...branch.componentStructure!.controls.at(0)!, when: [[{ controlId: "show-mode", value: "on" }]] },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "mode" })).toHaveAccessibleDescription(
      "Inactive path; selecting activates ancestors",
    );

    await userEvent.click(screen.getByRole("radio", { name: "Large" }));

    expect(screen.getByRole("switch", { name: "showMode" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: large" })).toHaveAccessibleDescription("Active path");
  });

  it("treats a branch alternative named off as a selection, not a conditional switch-off", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "plain", "preview"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        {
          ...connection("a-plain", "app", "plain"),
          component: {
            paths: [
              [
                { controlId: "parent", value: "on" },
                { controlId: "view", value: "off" },
              ],
            ],
          },
        },
        {
          ...connection("z-preview", "app", "preview"),
          component: {
            paths: [
              [
                { controlId: "parent", value: "on" },
                { controlId: "view", value: "on" },
              ],
            ],
          },
        },
      ],
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "parent", source: "app", label: "showPage", kind: "conditional", when: [[]] },
          {
            id: "view",
            source: "app",
            label: "view",
            kind: "branch",
            when: [[{ controlId: "parent", value: "on" }]],
            alternatives: [
              { id: "off", label: "No preview" },
              { id: "on", label: "Preview" },
            ],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("radio", { name: "No preview" }));

    expect(screen.getByRole("switch", { name: "showPage" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Active path");
  });

  it("dims an inactive connection and its label even when both endpoint cards are active", async () => {
    const graph: DiagramGraph = {
      ...diagram.graph,
      edges: [{ ...diagram.graph.edges.at(0)!, label: "optional" }, connection("always", "app", "details")],
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("article", { name: "component: Details" })).toHaveAccessibleDescription("Active path");
    expect(screen.getByRole("img", { name: "app to details: Inactive path" })).toBeVisible();
    const label = within(screen.getByRole("group", { name: "Diagram canvas" })).getByText("optional");
    expect(label.parentElement).toHaveStyle({ opacity: "0.25" });
  });

  it("preserves a child selection while its parent is off and restores its effective path without moving connections", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "panel", "details"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        { ...connection("app-panel", "app", "panel"), component: { paths: [[{ controlId: "panel", value: "on" }]] } },
        {
          ...connection("panel-details", "panel", "details"),
          component: { paths: [[{ controlId: "details", value: "on" }]] },
        },
      ],
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "panel", source: "app", label: "showPanel", kind: "conditional", when: [[]] },
          { id: "details", source: "panel", label: "showDetails", kind: "conditional", when: [[]] },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    const route = screen
      .getByRole("img", { name: "panel to details: Inactive path" })
      .querySelector("path")!
      .getAttribute("d");

    await userEvent.click(screen.getByRole("switch", { name: "showDetails" }));
    await userEvent.click(screen.getByRole("switch", { name: "showPanel" }));

    expect(screen.getByRole("switch", { name: "showDetails" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: details" })).toHaveAccessibleDescription("Inactive path");
    await userEvent.click(screen.getByRole("switch", { name: "showPanel" }));
    expect(screen.getByRole("article", { name: "component: details" })).toHaveAccessibleDescription("Active path");
    expect(screen.getByRole("img", { name: "panel to details: Active path" }).querySelector("path")).toHaveAttribute(
      "d",
      route,
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("turns an inactive child off without activating its ancestors", async () => {
    const graph: DiagramGraph = {
      ...branchGraph([
        connection("a-small", "app", "small", "small"),
        connection("z-large", "app", "large", "large"),
        {
          ...connection("small-leaf", "small", "leaf"),
          component: { paths: [[{ controlId: "show-leaf", value: "on" }]] },
        },
        connection("large-one", "large", "one"),
        connection("one-two", "one", "two"),
      ]),
    };
    graph.componentStructure!.controls.push({
      id: "show-leaf",
      source: "small",
      label: "showLeaf",
      kind: "conditional",
      when: [[]],
    });
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "showLeaf" }));
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    await userEvent.click(screen.getByRole("switch", { name: "showLeaf" }));

    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "showLeaf" })).not.toBeChecked();
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
          diagram={{ ...diagram, graph }}
          onOpenSource={() => {}}
        />
        <DiagramRenderer
          ariaLabel="Second composition"
          annotations={annotations}
          diagram={{ ...diagram, graph }}
          onOpenSource={() => {}}
        />
      </>,
    );
    await waitForDiagramReady();
    const first = within(screen.getByRole("region", { name: "First composition" }));
    const second = within(screen.getByRole("region", { name: "Second composition" }));

    await userEvent.click(first.getByRole("radio", { name: "Large" }));

    expect(first.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(second.getByRole("radio", { name: "Small" })).toBeChecked();
    expect(second.getByRole("article", { name: "component: small" })).toHaveAccessibleDescription("Active path");
  });

  it("retains the component title and displays every supplier-prop pair of a merged node", async () => {
    const graph: DiagramGraph = {
      ...diagram.graph,
      nodes: [
        diagram.graph.nodes.at(0)!,
        {
          ...diagram.graph.nodes.at(1)!,
          component: {
            definitionId: "src/details.tsx:Details",
            origins: [
              { supplierId: "src/page.tsx:Page", supplierTitle: "Page", prop: "footer" },
              { supplierId: "src/modal.tsx:Modal", supplierTitle: "Modal", prop: "children" },
              { supplierId: "src/page.tsx:Page", supplierTitle: "Page", prop: "header" },
            ],
          },
        },
      ],
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    const card = screen.getByRole("article", { name: "component: Details" });

    expect(within(card).getByRole("heading", { name: "Details" })).toBeVisible();
    const origins = within(within(card).getByRole("list", { name: "Supplied content origins" }));
    expect(origins.getByText("Page → footer")).toBeVisible();
    expect(origins.getByText("Modal → children")).toBeVisible();
    expect(origins.getByText("Page → header")).toBeVisible();
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

    await userEvent.click(screen.getByRole("switch", { name: "showDetails" }));
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
          component: { paths: [[{ controlId: "supplier-visible", value: "on" }]] },
        },
        connection("app-shared", "app", "shared"),
        connection("supplier-shared", "supplier", "shared"),
        {
          ...connection("shared-leaf", "shared", "leaf"),
          component: { paths: [[{ controlId: "child", value: "on" }]] },
        },
      ],
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "supplier-visible", source: "app", label: "supplier visible", kind: "conditional", when: [[]] },
          { id: "parent", source: "supplier", label: "parent", kind: "conditional", when: [[]] },
          {
            id: "child",
            source: "shared",
            label: "child",
            kind: "conditional",
            when: [[{ controlId: "parent", value: "on" }]],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    await userEvent.click(screen.getByRole("switch", { name: "child" }));

    expect(screen.getByRole("switch", { name: "supplier visible" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "parent" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: leaf" })).toHaveAccessibleDescription("Active path");
  });

  it("enables one minimum-change OR prerequisite route even when candidate owner routes have different lengths", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "supplier", "leaf"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        {
          ...connection("app-supplier", "app", "supplier"),
          component: { paths: [[{ controlId: "supplier-visible", value: "on" }]] },
        },
        { ...connection("app-leaf", "app", "leaf"), component: { paths: [[{ controlId: "child", value: "on" }]] } },
      ],
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "supplier-visible", source: "app", label: "supplier visible", kind: "conditional", when: [[]] },
          { id: "direct", source: "app", label: "direct", kind: "conditional", when: [[]] },
          { id: "supplied", source: "supplier", label: "supplied", kind: "conditional", when: [[]] },
          {
            id: "child",
            source: "app",
            label: "child",
            kind: "conditional",
            when: [[{ controlId: "direct", value: "on" }], [{ controlId: "supplied", value: "on" }]],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await userEvent.click(screen.getByRole("switch", { name: "supplied" }));
    await userEvent.click(screen.getByRole("switch", { name: "supplier visible" }));

    await userEvent.click(screen.getByRole("switch", { name: "child" }));

    const direct = screen.getByRole("switch", { name: "direct" }) as HTMLInputElement;
    const supplier = screen.getByRole("switch", { name: "supplier visible" }) as HTMLInputElement;
    expect(Number(direct.checked) + Number(supplier.checked)).toBe(1);
    expect(screen.getByRole("article", { name: "component: leaf" })).toHaveAccessibleDescription("Active path");
  });

  it("honors transitive when-only prerequisites for branch emphasis and descendant activation", async () => {
    const graph: DiagramGraph = {
      groups: [],
      nodes: ["app", "plain", "preview"].map((id) => ({ id, type: "default", kind: "component", title: id })),
      edges: [
        { ...connection("a-plain", "app", "plain"), component: { paths: [[{ controlId: "view", value: "plain" }]] } },
        {
          ...connection("z-preview", "app", "preview"),
          component: { paths: [[{ controlId: "view", value: "preview" }]] },
        },
      ],
      componentStructure: {
        roots: ["app"],
        controls: [
          { id: "grandparent", source: "app", label: "grandparent", kind: "conditional", when: [[]] },
          {
            id: "parent",
            source: "app",
            label: "parent",
            kind: "conditional",
            when: [[{ controlId: "grandparent", value: "on" }]],
          },
          {
            id: "view",
            source: "app",
            label: "view",
            kind: "branch",
            when: [[{ controlId: "parent", value: "on" }]],
            alternatives: [
              { id: "plain", label: "Plain" },
              { id: "preview", label: "Preview" },
            ],
          },
        ],
      },
    };
    render(<DiagramRenderer annotations={annotations} diagram={{ ...diagram, graph }} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Inactive path");

    await userEvent.click(screen.getByRole("radio", { name: "Plain" }));
    await userEvent.click(screen.getByRole("switch", { name: "grandparent" }));

    expect(screen.getByRole("switch", { name: "parent" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Plain" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Inactive path");
    expect(screen.getByRole("radiogroup", { name: "view" })).toHaveAccessibleDescription(
      "Inactive path; selecting activates ancestors",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Plain" }));
    expect(screen.getByRole("switch", { name: "grandparent" })).toBeChecked();
    expect(screen.getByRole("article", { name: "component: plain" })).toHaveAccessibleDescription("Active path");
  });

  it("starts conditional paths off while keeping their controls and nodes visible", async () => {
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();

    expect(screen.getByRole("switch", { name: "showDetails" })).not.toBeChecked();
    expect(screen.getByRole("article", { name: "component: Details" })).toHaveAccessibleDescription("Inactive path");
    expect(screen.getByRole("article", { name: "component: App" })).toHaveAccessibleDescription("Active path");
  });
});
