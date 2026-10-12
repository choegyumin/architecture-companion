import { z } from "zod";

import { artifactSchema, parseArtifact } from "@/features/artifact/artifact";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import {
  componentCompositionSchema,
  componentStructureDiagramGraphSchema,
  diagramControlSchema,
} from "@/features/diagram/diagram-graph";

const validDiagram = {
  id: "checkout-structure",
  title: "Checkout structure",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview checkout responsibilities and dependencies.\n\n## Regeneration\nInspect the checkout page and payment client and map their verified relationships.",
  diagram: {
    layout: { id: "elk-layered" },
    graph: {
      groups: [{ id: "checkout", title: "Checkout" }],
      nodes: [
        {
          id: "checkout-page",
          type: "default",
          kind: "component",
          title: "Checkout page",
          description: "Coordinates checkout",
          details: ["Loads the cart", "Submits the order"],
          groupId: "checkout",
          links: [{ text: "checkout-page.tsx", href: "source:///src/checkout-page.tsx#L1-L20" }],
        },
        { id: "payment-client", type: "default", kind: "client", title: "Payment client", groupId: "checkout" },
      ],
      edges: [
        {
          id: "uses-payment-client",
          type: "default",
          source: "checkout-page",
          target: "payment-client",
          kind: "dependency",
          label: "Uses payment client",
          href: "https://example.com/payment-client",
        },
      ],
    },
  },
} as const;

const validSequenceDiagram = {
  ...validDiagram,
  diagram: {
    layout: { id: "sequence" },
    graph: {
      groups: [],
      nodes: [
        { id: "client", type: "lifeline", kind: "participant", title: "Client", activations: [] },
        { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
      ],
      edges: [
        {
          id: "request",
          type: "message",
          source: "client",
          target: "server",
          label: "Request",
          messageType: "sync",
        },
      ],
    },
  },
} as const;

const validComponentDiagram = {
  ...validDiagram,
  diagram: {
    layout: { id: "component-structure" },
    graph: {
      ...validDiagram.diagram.graph,
      edges: [
        { id: "inline", type: "default", source: "checkout-page", target: "payment-client" },
        {
          id: "conditional",
          type: "control",
          source: "checkout-page",
          target: "payment-client",
          activeWhen: [[{ controlId: "ready", value: "on" }]],
        },
      ],
      layoutContext: {
        roots: ["checkout-page"],
        controls: [{ id: "ready", owner: "checkout-page", type: "conditional", label: "ready", dependsOn: [[]] }],
      },
    },
  },
} as const;

const composition = {
  type: "node",
  slot: "children",
  origins: [
    { supplierId: "outside:App", supplierTitle: "App", slot: "header" },
    { supplierId: "outside:Other", supplierTitle: "Other", slot: "footer" },
  ],
};
const nodeLayoutContext = { definitionId: "definition:Shared", origins: composition.origins };

describe("control storage contract", () => {
  it.each([
    { type: "conditional", label: "ready" },
    {
      type: "branch",
      label: "ready",
      polarityPair: true,
      cases: [
        { id: "false", label: "ready" },
        { id: "true", label: "!ready" },
      ],
    },
  ])("uses type to select the $type contract", (fields) => {
    const control = { id: "gate", owner: "root", dependsOn: [[]], ...fields };
    expect(diagramControlSchema.parse(control)).toEqual(control);
    const { type, ...rest } = control;
    expect(diagramControlSchema.safeParse({ ...rest, kind: type }).success).toBe(false);
    expect(diagramControlSchema.safeParse({ ...control, kind: type }).success).toBe(false);
  });
});

describe("component layout context", () => {
  it("preserves node definition IDs and aggregated supplier slots in layoutContext", () => {
    const graph = {
      ...validComponentDiagram.diagram.graph,
      nodes: validComponentDiagram.diagram.graph.nodes.map((node) => ({
        ...node,
        layoutContext: nodeLayoutContext,
      })),
    };
    const artifact = { ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } };
    expect(parseArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });

  it.each([
    null,
    {},
    { ...nodeLayoutContext, definitionId: "" },
    { definitionId: "definition:Shared" },
    { ...nodeLayoutContext, origins: [{ supplierId: "outside:App", supplierTitle: "App", prop: "header" }] },
    { ...nodeLayoutContext, origins: [{ ...composition.origins.at(0), slot: "" }] },
    { ...nodeLayoutContext, component: nodeLayoutContext },
  ])("rejects malformed node layout context: %j", (layoutContext) => {
    const graph = {
      ...validComponentDiagram.diagram.graph,
      nodes: validComponentDiagram.diagram.graph.nodes.map((node) => ({ ...node, layoutContext })),
    };
    expect(() =>
      parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
    ).toThrow("Invalid artifact");
  });

  it("rejects the removed node component wrapper", () => {
    const graph = {
      ...validComponentDiagram.diagram.graph,
      nodes: validComponentDiagram.diagram.graph.nodes.map((node) => ({ ...node, component: nodeLayoutContext })),
    };
    expect(() =>
      parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
    ).toThrow('Unrecognized key: "component"');
  });

  it.each(["elk-layered", "dependency-graph", "sequence"])("does not widen the %s graph contract", (id) => {
    const graph = id === "sequence" ? validSequenceDiagram.diagram.graph : validDiagram.diagram.graph;
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          layout: { id },
          graph: { ...graph, layoutContext: validComponentDiagram.diagram.graph.layoutContext },
        },
      }),
    ).toThrow('Unrecognized key: "layoutContext"');
  });

  it.each(["elk-layered", "dependency-graph", "sequence"])("does not widen the %s node contract", (id) => {
    const graph = id === "sequence" ? validSequenceDiagram.diagram.graph : validDiagram.diagram.graph;
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          layout: { id },
          graph: { ...graph, nodes: graph.nodes.map((node) => ({ ...node, layoutContext: nodeLayoutContext })) },
        },
      }),
    ).toThrow('Unrecognized key: "layoutContext"');
  });

  it("stores roots and controls in the graph layoutContext without accepting additional", () => {
    expect(parseArtifact(validComponentDiagram)).toEqual(validComponentDiagram);
    const { layoutContext, ...base } = validComponentDiagram.diagram.graph;
    for (const graph of [
      base,
      { ...base, additional: layoutContext },
      { ...base, layoutContext, additional: layoutContext },
    ]) {
      expect(() =>
        parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
      ).toThrow("Invalid artifact");
    }
  });
});

describe("component composition metadata", () => {
  it.each(["node", "render", "component"])("validates the framework-neutral %s supply type", (type) => {
    const metadata = { ...composition, type };
    expect(componentCompositionSchema.parse(metadata)).toEqual(metadata);
  });

  it("preserves omitted composition as the direct-rendering default", () => {
    expect(parseArtifact(validComponentDiagram)).toEqual(validComponentDiagram);
  });

  it("preserves per-edge type, consumer slot, and original supplier-slot pairs through JSON", () => {
    const graph = {
      ...validComponentDiagram.diagram.graph,
      edges: validComponentDiagram.diagram.graph.edges.map((edge) => ({ ...edge, layoutContext: { composition } })),
    };
    const artifact = { ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } };

    expect(parseArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
    expect(projectDecisionNodes(componentStructureDiagramGraphSchema.parse(graph))).toEqual(
      projectDecisionNodes(componentStructureDiagramGraphSchema.parse(validComponentDiagram.diagram.graph)),
    );
  });

  it.each([{}, { composition: null }])(
    "preserves explicit direct-rendering context %j and projects it like the omitted default",
    (layoutContext) => {
      const graph = {
        ...validComponentDiagram.diagram.graph,
        edges: validComponentDiagram.diagram.graph.edges.map((edge) => ({ ...edge, layoutContext })),
      };
      const artifact = { ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } };

      expect(parseArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
      expect(projectDecisionNodes(componentStructureDiagramGraphSchema.parse(graph))).toEqual(
        projectDecisionNodes(componentStructureDiagramGraphSchema.parse(validComponentDiagram.diagram.graph)),
      );
    },
  );

  it.each([
    ...["inline-render", "node-prop", "render-prop", "component-prop", "slot", "", null].map((type) => ({
      ...composition,
      type,
    })),
    { ...composition, kind: "node" },
    { ...composition, input: "children" },
    { ...composition, slot: "" },
    { type: "node" },
    { ...composition, unexpected: true },
    { ...composition, origins: [{ ...composition.origins.at(0), supplierId: "" }] },
    { ...composition, origins: [{ ...composition.origins.at(0), supplierTitle: "" }] },
    { ...composition, origins: [{ ...composition.origins.at(0), slot: "" }] },
    { ...composition, origins: [{ ...composition.origins.at(0), input: "header" }] },
    { ...composition, origins: [{ ...composition.origins.at(0), prop: "header" }] },
  ])("rejects malformed composition metadata: %j", (invalid) => {
    for (const edge of validComponentDiagram.diagram.graph.edges) {
      const graph = {
        ...validComponentDiagram.diagram.graph,
        edges: [{ ...edge, layoutContext: { composition: invalid } }],
      };
      expect(() =>
        parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
      ).toThrow("Invalid artifact");
    }
  });

  it.each([null, composition, { composition, unexpected: true }])(
    "rejects malformed edge layout context: %j",
    (layoutContext) => {
      const graph = {
        ...validComponentDiagram.diagram.graph,
        edges: validComponentDiagram.diagram.graph.edges.map((edge) => ({ ...edge, layoutContext })),
      };
      expect(() =>
        parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
      ).toThrow("Invalid artifact");
    },
  );

  it.each([composition, null])("rejects the removed top-level edge composition: %j", (composition) => {
    const graph = {
      ...validComponentDiagram.diagram.graph,
      edges: validComponentDiagram.diagram.graph.edges.map((edge) => ({ ...edge, composition })),
    };
    expect(() =>
      parseArtifact({ ...validComponentDiagram, diagram: { ...validComponentDiagram.diagram, graph } }),
    ).toThrow('Unrecognized key: "composition"');
  });

  it.each(["elk-layered", "dependency-graph", "sequence"])("does not widen the %s edge contract", (id) => {
    const base = id === "sequence" ? validSequenceDiagram.diagram.graph : validDiagram.diagram.graph;
    for (const metadata of [composition, null]) {
      const graph = {
        ...base,
        edges: base.edges.map((edge) => ({ ...edge, layoutContext: { composition: metadata } })),
      };

      expect(() => parseArtifact({ ...validDiagram, diagram: { layout: { id }, graph } })).toThrow(
        'Unrecognized key: "layoutContext"',
      );
    }
  });

  it("emits distinct component edge definitions without changing generic edges", () => {
    const schema = z.toJSONSchema(artifactSchema, { target: "draft-2020-12", io: "input", reused: "inline" });

    expect(schema.$defs).toMatchObject({
      ComponentOrigin: {
        type: "object",
        required: ["supplierId", "supplierTitle", "slot"],
        additionalProperties: false,
        properties: { slot: { type: "string", minLength: 1 } },
      },
      ComponentComposition: {
        type: "object",
        required: ["type", "origins"],
        additionalProperties: false,
        properties: { type: { type: "string", enum: ["node", "render", "component"] } },
      },
      ComponentStructureEdgeLayoutContext: {
        type: "object",
        additionalProperties: false,
        properties: { composition: { anyOf: [{ $ref: "#/$defs/ComponentComposition" }, { type: "null" }] } },
      },
      ComponentStructureDefaultEdge: {
        properties: { layoutContext: { $ref: "#/$defs/ComponentStructureEdgeLayoutContext" } },
      },
      ComponentStructureControlEdge: {
        properties: { layoutContext: { $ref: "#/$defs/ComponentStructureEdgeLayoutContext" } },
      },
    });
    expect(schema.$defs?.ComponentStructureDefaultEdge.required).not.toContain("layoutContext");
    expect(schema.$defs?.ComponentStructureControlEdge.required).not.toContain("layoutContext");
    expect(schema.$defs?.ComponentStructureEdgeLayoutContext.required ?? []).not.toContain("composition");
    expect(JSON.stringify(schema.$defs?.ComponentStructureGraph)).toContain("#/$defs/ComponentStructureDefaultEdge");
    expect(JSON.stringify(schema.$defs?.ComponentStructureGraph)).toContain("#/$defs/ComponentStructureControlEdge");
    for (const name of ["DefaultNode", "DefaultEdge", "ControlEdge"]) {
      expect(schema.$defs?.[name]?.properties).not.toHaveProperty("layoutContext");
    }
    expect(schema.$defs?.ComponentStructureDefaultEdge.properties).not.toHaveProperty("composition");
    expect(schema.$defs?.ComponentStructureControlEdge.properties).not.toHaveProperty("composition");
  });
});

describe("artifact parsing", () => {
  it("preserves the common diagram contract", () => {
    expect(parseArtifact(validDiagram)).toEqual(validDiagram);
  });

  it("preserves diagram-level links", () => {
    const diagram = {
      ...validDiagram,
      links: [{ text: "Workflow review test", href: "source:///specs/review-architecture.spec.tsx" }],
    } as const;

    expect(parseArtifact(diagram)).toEqual(diagram);
  });

  it("preserves Markdown regeneration instructions through JSON serialization", () => {
    const diagram = {
      ...validDiagram,
      instructions: [
        "## Purpose",
        "Review checkout module dependencies.",
        "",
        "## Regeneration",
        "Run from the scope root:",
        "",
        "```sh",
        'node "<generator-directory>/run.js" \\',
        '  --base "." \\',
        '  "src/checkout"',
        "```",
      ].join("\n"),
    } as const;

    expect(parseArtifact(JSON.parse(JSON.stringify(diagram)))).toEqual(diagram);
  });

  it.each([undefined, "", 42, null])("rejects missing or invalid regeneration instructions: %j", (instructions) => {
    expect(() => parseArtifact({ ...validDiagram, instructions })).toThrow("Invalid artifact");
  });

  it("rejects the replaced generatorInstructions field", () => {
    expect(() => parseArtifact({ ...validDiagram, generatorInstructions: "Regenerate from src." })).toThrow(
      "Invalid artifact",
    );
  });

  it("preserves provider-owned layout options", () => {
    const diagram = {
      ...validDiagram,
      diagram: { ...validDiagram.diagram, layout: { id: "elk-layered", options: { elk: { direction: "RIGHT" } } } },
    };

    expect(parseArtifact(diagram)).toEqual(diagram);
  });

  it("parses supported layout configurations", () => {
    expect(parseArtifact(validSequenceDiagram).diagram.layout).toEqual({ id: "sequence" });
    expect(
      parseArtifact({ ...validDiagram, diagram: { ...validDiagram.diagram, layout: { id: "dependency-graph" } } })
        .diagram.layout,
    ).toEqual({
      id: "dependency-graph",
    });
  });

  it("restricts dependency graphs to default nodes and edges", () => {
    const dependencyDiagram = {
      ...validDiagram,
      diagram: { ...validDiagram.diagram, layout: { id: "dependency-graph" } },
    } as const;
    expect(parseArtifact(dependencyDiagram).diagram.graph).toEqual(validDiagram.diagram.graph);
    const fragment = {
      id: "fragment",
      type: "fragment",
      title: "Alternative",
      kind: "frame",
      operator: "alt",
      branches: [{ id: "branch", guard: "valid", startMessageId: "request", endMessageId: "request" }],
    } as const;
    for (const node of [...validSequenceDiagram.diagram.graph.nodes, fragment]) {
      expect(() =>
        parseArtifact({
          ...dependencyDiagram,
          diagram: { ...dependencyDiagram.diagram, graph: { ...dependencyDiagram.diagram.graph, nodes: [node] } },
        }),
      ).toThrow('graph.nodes.0.type: Invalid input: expected "default"');
    }
    expect(() =>
      parseArtifact({
        ...dependencyDiagram,
        diagram: {
          ...dependencyDiagram.diagram,
          graph: { ...dependencyDiagram.diagram.graph, edges: [validSequenceDiagram.diagram.graph.edges.at(0)] },
        },
      }),
    ).toThrow('graph.edges.0.type: Invalid input: expected "default"');
  });

  it("rejects unsupported layout configurations", () => {
    expect(() =>
      parseArtifact({ ...validDiagram, diagram: { ...validDiagram.diagram, layout: { id: "unknown" } } }),
    ).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          layout: { id: "elk-layered", options: { elk: { direction: "DIAGONAL" } } },
        },
      }),
    ).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          layout: { id: "elk-layered", options: { spacing: 24 } },
        },
      }),
    ).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: { ...validDiagram.diagram, layout: { id: "sequence", options: {} } },
      }),
    ).toThrow("Invalid artifact");
  });

  test("sequence diagrams do not allow groups", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        diagram: {
          ...validSequenceDiagram.diagram,
          graph: {
            ...validSequenceDiagram.diagram.graph,
            groups: [{ id: "checkout", title: "Checkout" }],
          },
        },
      }),
    ).toThrow("Sequence layout does not support diagram groups");
  });

  test("sequence diagrams require at least one lifeline", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        diagram: {
          ...validSequenceDiagram.diagram,
          graph: {
            ...validSequenceDiagram.diagram.graph,
            nodes: [{ id: "service", type: "default", kind: "component", title: "Service" }],
            edges: [],
          },
        },
      }),
    ).toThrow("Invalid discriminator value. Expected 'lifeline' | 'fragment'");
  });

  test("sequence diagrams allow only lifeline and fragment nodes", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        diagram: {
          ...validSequenceDiagram.diagram,
          graph: {
            ...validSequenceDiagram.diagram.graph,
            nodes: [
              ...validSequenceDiagram.diagram.graph.nodes,
              { id: "service", type: "default", kind: "component", title: "Service" },
            ],
          },
        },
      }),
    ).toThrow("Invalid discriminator value. Expected 'lifeline' | 'fragment'");
  });

  test("sequence diagrams allow only message edges", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        diagram: {
          ...validSequenceDiagram.diagram,
          graph: {
            ...validSequenceDiagram.diagram.graph,
            edges: [{ id: "dependency", type: "default", source: "client", target: "server" }],
          },
        },
      }),
    ).toThrow('graph.edges.0.type: Invalid input: expected "message"');
  });

  it("rejects duplicate element IDs and broken references", () => {
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            edges: [{ ...validDiagram.diagram.graph.edges.at(0), id: "checkout-page" }],
          },
        },
      }),
    ).toThrow("Duplicate diagram element ID: checkout-page");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            edges: [{ ...validDiagram.diagram.graph.edges.at(0), target: "missing" }],
          },
        },
      }),
    ).toThrow("Diagram edge uses-payment-client targets unknown node missing");
  });

  it("rejects missing groups and group cycles", () => {
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            nodes: [{ ...validDiagram.diagram.graph.nodes.at(0), groupId: "missing" }],
            edges: [],
          },
        },
      }),
    ).toThrow("Diagram node checkout-page belongs to unknown group missing");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            groups: [
              { id: "checkout", title: "Checkout", parentId: "application" },
              { id: "application", title: "Application", parentId: "checkout" },
            ],
          },
        },
      }),
    ).toThrow("Diagram group hierarchy contains a cycle");
  });

  it.each(["built-in:freeform", "project:dependency-graph", "global:dependency-graph"])(
    "allows generator reference %j",
    (generator) => {
      const diagram = { ...validDiagram, generator } as const;

      expect(parseArtifact(diagram)).toEqual(diagram);
    },
  );

  it.each([
    "",
    "freeform",
    "workspace:freeform",
    "built-in:",
    "built-in:Dependency-Graph",
    "built-in:dependency_graph",
    "built-in:-dependency-graph",
    "built-in:dependency-graph-",
    "built-in:dependency--graph",
  ])("rejects invalid generator reference %j", (generator) => {
    expect(() => parseArtifact({ ...validDiagram, generator })).toThrow("Invalid artifact");
  });

  it("rejects unknown renderer types", () => {
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            nodes: [{ ...validDiagram.diagram.graph.nodes.at(0), type: "unknown" }],
          },
        },
      }),
    ).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        diagram: {
          ...validDiagram.diagram,
          graph: {
            ...validDiagram.diagram.graph,
            edges: [{ ...validDiagram.diagram.graph.edges.at(0), type: "unknown" }],
          },
        },
      }),
    ).toThrow("Invalid artifact");
  });

  it("validates lifeline messages and activation bounds", () => {
    const diagram = {
      ...validDiagram,
      diagram: {
        ...validDiagram.diagram,
        graph: {
          ...validDiagram.diagram.graph,
          groups: [],
          nodes: [
            {
              id: "client",
              type: "lifeline",
              kind: "participant",
              title: "Client",
              activations: [
                {
                  id: "request",
                  startsAt: { messageId: "request", endpoint: "source" },
                  endsAt: { messageId: "response", endpoint: "target" },
                },
              ],
            },
            { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
          ],
          edges: [
            {
              id: "request",
              type: "message",
              source: "client",
              target: "server",
              label: "Request",
              messageType: "sync",
            },
            {
              id: "response",
              type: "message",
              source: "server",
              target: "client",
              label: "Response",
              messageType: "return",
            },
          ],
        },
      },
    } as const;

    expect(parseArtifact(diagram)).toEqual(diagram);
    expect(() =>
      parseArtifact({
        ...diagram,
        diagram: {
          ...diagram.diagram,
          graph: {
            ...diagram.diagram.graph,
            edges: [{ ...diagram.diagram.graph.edges.at(0), source: "missing" }, diagram.diagram.graph.edges.at(1)],
          },
        },
      }),
    ).toThrow("Message edge request source must be a lifeline");
  });
});
