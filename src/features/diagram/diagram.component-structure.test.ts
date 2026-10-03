import { parseDiagram } from "@/features/diagram/diagram";

const componentDiagram = {
  id: "component-paths",
  title: "Component paths",
  updatedAt: "2026-10-04T09:00:00.000Z",
  generator: "built-in:react-component-structure",
  instructions: "Regenerate from the selected React source files.",
  layout: { id: "elk-layered" },
  graph: {
    groups: [],
    nodes: [
      { type: "default", id: "app", title: "App", component: { definitionId: "app", origins: [] } },
      {
        type: "default",
        id: "body",
        title: "Body",
        component: {
          definitionId: "body",
          origins: [{ supplierId: "app", supplierTitle: "App", prop: "children" }],
        },
      },
    ],
    edges: [
      {
        type: "default",
        id: "app-body",
        source: "app",
        target: "body",
        component: { paths: [[{ controlId: "show", value: "on" }]] },
      },
    ],
    componentStructure: {
      roots: ["app"],
      controls: [{ id: "show", source: "app", label: "show", kind: "conditional", when: [[]] }],
    },
  },
} as const;

describe("component structure diagram contract", () => {
  it.each(["dependency-graph", "sequence"])("rejects component controls with the %s layout", (id) => {
    expect(() => parseDiagram({ ...componentDiagram, layout: { id } })).toThrow(
      "Component structure requires ELK layered layout",
    );
  });

  it("rejects unsupported component node and edge types", () => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          nodes: [
            { id: "app", type: "lifeline", title: "App", kind: "participant", activations: [] },
            { id: "body", type: "lifeline", title: "Body", kind: "participant", activations: [] },
          ],
        },
      }),
    ).toThrow("Component structure supports only default nodes");
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [{ id: "app-body", type: "message", source: "app", target: "body" }],
        },
      }),
    ).toThrow("Component structure supports only default edges");
  });

  it("preserves component metadata through serialization", () => {
    expect(parseDiagram(JSON.parse(JSON.stringify(componentDiagram)))).toEqual(componentDiagram);
  });

  it("rejects a path referencing an unknown control", () => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [
            {
              ...componentDiagram.graph.edges.at(0),
              component: { paths: [[{ controlId: "missing", value: "on" }]] },
            },
          ],
        },
      }),
    ).toThrow("Unknown component control: missing");
  });

  it.each([
    { control: componentDiagram.graph.componentStructure.controls.at(0), value: "true" },
    {
      control: {
        id: "show",
        source: "app",
        label: "mode",
        kind: "branch",
        when: [[]],
        alternatives: [
          { id: "first", label: "First" },
          { id: "second", label: "Second" },
        ],
      },
      value: "missing",
    },
  ])("rejects a value outside the control alternatives: $value", ({ control, value }) => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          componentStructure: { roots: ["app"], controls: [control] },
          edges: [{ ...componentDiagram.graph.edges.at(0), component: { paths: [[{ controlId: "show", value }]] } }],
        },
      }),
    ).toThrow(`Invalid value for component control show: ${value}`);
  });

  it.each([
    {
      roots: ["missing"],
      controls: componentDiagram.graph.componentStructure.controls,
      error: "Unknown component root: missing",
    },
    {
      roots: ["app", "app"],
      controls: componentDiagram.graph.componentStructure.controls,
      error: "Duplicate component root: app",
    },
    {
      roots: ["app"],
      controls: [{ ...componentDiagram.graph.componentStructure.controls.at(0), source: "missing" }],
      error: "Unknown component control source: missing",
    },
    {
      roots: ["app"],
      controls: [
        ...componentDiagram.graph.componentStructure.controls,
        ...componentDiagram.graph.componentStructure.controls,
      ],
      error: "Duplicate component control: show",
    },
    {
      roots: ["app"],
      controls: [
        {
          id: "show",
          source: "app",
          kind: "branch",
          label: "mode",
          when: [[]],
          alternatives: [
            { id: "same", label: "First" },
            { id: "same", label: "Second" },
          ],
        },
      ],
      error: "Duplicate component alternative: same",
    },
  ])("rejects inconsistent metadata: $error", ({ roots, controls, error }) => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: { ...componentDiagram.graph, edges: [], componentStructure: { roots, controls } },
      }),
    ).toThrow(error);
  });

  it.each(["show", "other"])("rejects cyclic control prerequisites through %s", (dependency) => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          componentStructure: {
            roots: ["app"],
            controls: [
              {
                ...componentDiagram.graph.componentStructure.controls.at(0),
                when: [[{ controlId: dependency, value: "on" }]],
              },
              {
                id: "other",
                source: "body",
                kind: "conditional",
                label: "other",
                when: [[{ controlId: "show", value: "on" }]],
              },
            ],
          },
        },
      }),
    ).toThrow("Component control prerequisites contain a cycle");
  });

  it("rejects contradictory requirements within one path", () => {
    expect(() =>
      parseDiagram({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [
            {
              ...componentDiagram.graph.edges.at(0),
              component: {
                paths: [
                  [
                    { controlId: "show", value: "on" },
                    { controlId: "show", value: "off" },
                  ],
                ],
              },
            },
          ],
        },
      }),
    ).toThrow("Contradictory component path: show");
  });
});
