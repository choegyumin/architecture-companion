import { parseArtifact } from "@/features/artifact/artifact";

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
        activeWhen: [[{ controlId: "show", value: "on" }]],
      },
    ],
    roots: ["app"],
    controls: [{ id: "show", owner: "app", label: "show", kind: "conditional", dependsOn: [[]] }],
  },
} as const;

describe("component structure diagram contract", () => {
  it.each(["dependency-graph", "sequence"])("rejects component controls with the %s layout", (id) => {
    expect(() => parseArtifact({ ...componentDiagram, layout: { id } })).toThrow(
      "Component structure requires ELK layered layout",
    );
  });

  it("rejects unsupported component node and edge types", () => {
    expect(() =>
      parseArtifact({
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
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [{ id: "app-body", type: "message", source: "app", target: "body" }],
        },
      }),
    ).toThrow("Component structure supports only default edges");
  });

  it("preserves component metadata through serialization", () => {
    expect(parseArtifact(JSON.parse(JSON.stringify(componentDiagram)))).toEqual(componentDiagram);
  });

  it("rejects a path referencing an unknown control", () => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [
            {
              ...componentDiagram.graph.edges.at(0),
              activeWhen: [[{ controlId: "missing", value: "on" }]],
            },
          ],
        },
      }),
    ).toThrow("Unknown component control: missing");
  });

  it.each([
    { control: componentDiagram.graph.controls.at(0), value: "true" },
    {
      control: {
        id: "show",
        owner: "app",
        label: "mode",
        kind: "branch",
        dependsOn: [[]],
        cases: [
          { id: "first", label: "First" },
          { id: "second", label: "Second" },
        ],
      },
      value: "missing",
    },
  ])("rejects a value outside the control cases: $value", ({ control, value }) => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          roots: ["app"],
          controls: [control],
          edges: [{ ...componentDiagram.graph.edges.at(0), activeWhen: [[{ controlId: "show", value }]] }],
        },
      }),
    ).toThrow(`Invalid value for component control show: ${value}`);
  });

  it.each([
    {
      roots: ["missing"],
      controls: componentDiagram.graph.controls,
      error: "Unknown component root: missing",
    },
    {
      roots: ["app", "app"],
      controls: componentDiagram.graph.controls,
      error: "Duplicate component root: app",
    },
    {
      roots: ["app"],
      controls: [{ ...componentDiagram.graph.controls.at(0), owner: "missing" }],
      error: "Unknown component control owner: missing",
    },
    {
      roots: ["app"],
      controls: [...componentDiagram.graph.controls, ...componentDiagram.graph.controls],
      error: "Duplicate component control: show",
    },
    {
      roots: ["app"],
      controls: [
        {
          id: "show",
          owner: "app",
          kind: "branch",
          label: "mode",
          dependsOn: [[]],
          cases: [
            { id: "same", label: "First" },
            { id: "same", label: "Second" },
          ],
        },
      ],
      error: "Duplicate component control case: same",
    },
  ])("rejects inconsistent metadata: $error", ({ roots, controls, error }) => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: { ...componentDiagram.graph, edges: [], roots, controls },
      }),
    ).toThrow(error);
  });

  it.each(["show", "other"])("rejects cyclic control prerequisites through %s", (dependency) => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          roots: ["app"],
          controls: [
            {
              ...componentDiagram.graph.controls.at(0),
              dependsOn: [[{ controlId: dependency, value: "on" }]],
            },
            {
              id: "other",
              owner: "body",
              kind: "conditional",
              label: "other",
              dependsOn: [[{ controlId: "show", value: "on" }]],
            },
          ],
        },
      }),
    ).toThrow("Component control prerequisites contain a cycle");
  });

  it("rejects contradictory requirements within one path", () => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          edges: [
            {
              ...componentDiagram.graph.edges.at(0),
              activeWhen: [
                [
                  { controlId: "show", value: "on" },
                  { controlId: "show", value: "off" },
                ],
              ],
            },
          ],
        },
      }),
    ).toThrow("Contradictory component path: show");
  });

  it("rejects controls without declared roots", () => {
    const { roots: _roots, ...graph } = componentDiagram.graph;
    void _roots;
    expect(() => parseArtifact({ ...componentDiagram, graph })).toThrow("Component controls require declared roots");
  });

  it("rejects a node without incoming edges that is not a declared root", () => {
    expect(() =>
      parseArtifact({
        ...componentDiagram,
        graph: {
          ...componentDiagram.graph,
          nodes: [...componentDiagram.graph.nodes, { type: "default", id: "orphan", title: "Orphan" }],
        },
      }),
    ).toThrow("Component node without incoming edges must be a declared root: orphan");
  });
});
