import { parseArtifact } from "@/features/diagram/artifact";

const validDiagram = {
  id: "checkout-structure",
  title: "Checkout structure",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview checkout responsibilities and dependencies.\n\n## Regeneration\nInspect the checkout page and payment client and map their verified relationships.",
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
} as const;

const validSequenceDiagram = {
  ...validDiagram,
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
} as const;

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
      layout: { id: "elk-layered", options: { elk: { direction: "RIGHT" } } },
    };

    expect(parseArtifact(diagram)).toEqual(diagram);
  });

  it("parses supported layout configurations", () => {
    expect(parseArtifact(validSequenceDiagram).layout).toEqual({ id: "sequence" });
    expect(parseArtifact({ ...validDiagram, layout: { id: "dependency-graph" } }).layout).toEqual({
      id: "dependency-graph",
    });
  });

  it("restricts dependency graphs to default nodes and edges", () => {
    const dependencyDiagram = { ...validDiagram, layout: { id: "dependency-graph" } } as const;
    expect(parseArtifact(dependencyDiagram).graph).toEqual(validDiagram.graph);
    const fragment = {
      id: "fragment",
      type: "fragment",
      title: "Alternative",
      kind: "frame",
      operator: "alt",
      branches: [{ id: "branch", guard: "valid", startMessageId: "request", endMessageId: "request" }],
    } as const;
    for (const node of [...validSequenceDiagram.graph.nodes, fragment]) {
      expect(() =>
        parseArtifact({ ...dependencyDiagram, graph: { ...dependencyDiagram.graph, nodes: [node] } }),
      ).toThrow("Dependency graph layout supports only default nodes");
    }
    expect(() =>
      parseArtifact({
        ...dependencyDiagram,
        graph: { ...dependencyDiagram.graph, edges: [validSequenceDiagram.graph.edges.at(0)] },
      }),
    ).toThrow("Dependency graph layout supports only default edges");
  });

  it("rejects unsupported layout configurations", () => {
    expect(() => parseArtifact({ ...validDiagram, layout: { id: "unknown" } })).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({ ...validDiagram, layout: { id: "elk-layered", options: { elk: { direction: "DIAGONAL" } } } }),
    ).toThrow("Invalid artifact");
    expect(() => parseArtifact({ ...validDiagram, layout: { id: "elk-layered", options: { spacing: 24 } } })).toThrow(
      "Invalid artifact",
    );
    expect(() => parseArtifact({ ...validDiagram, layout: { id: "sequence", options: {} } })).toThrow(
      "Invalid artifact",
    );
  });

  test("sequence diagrams do not allow groups", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        graph: {
          ...validSequenceDiagram.graph,
          groups: [{ id: "checkout", title: "Checkout" }],
        },
      }),
    ).toThrow("Sequence layout does not support diagram groups");
  });

  test("sequence diagrams require at least one lifeline", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        graph: {
          ...validSequenceDiagram.graph,
          nodes: [{ id: "service", type: "default", kind: "component", title: "Service" }],
          edges: [],
        },
      }),
    ).toThrow("Sequence layout requires at least one lifeline");
  });

  test("sequence diagrams allow only lifeline and fragment nodes", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        graph: {
          ...validSequenceDiagram.graph,
          nodes: [
            ...validSequenceDiagram.graph.nodes,
            { id: "service", type: "default", kind: "component", title: "Service" },
          ],
        },
      }),
    ).toThrow("Sequence layout supports only lifeline and fragment nodes");
  });

  test("sequence diagrams allow only message edges", () => {
    expect(() =>
      parseArtifact({
        ...validSequenceDiagram,
        graph: {
          ...validSequenceDiagram.graph,
          edges: [{ id: "dependency", type: "default", source: "client", target: "server" }],
        },
      }),
    ).toThrow("Sequence layout supports only message edges");
  });

  it("rejects duplicate element IDs and broken references", () => {
    expect(() =>
      parseArtifact({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          edges: [{ ...validDiagram.graph.edges.at(0), id: "checkout-page" }],
        },
      }),
    ).toThrow("Duplicate diagram element ID: checkout-page");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          edges: [{ ...validDiagram.graph.edges.at(0), target: "missing" }],
        },
      }),
    ).toThrow("Diagram edge uses-payment-client targets unknown node missing");
  });

  it("rejects missing groups and group cycles", () => {
    expect(() =>
      parseArtifact({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          nodes: [{ ...validDiagram.graph.nodes.at(0), groupId: "missing" }],
          edges: [],
        },
      }),
    ).toThrow("Diagram node checkout-page belongs to unknown group missing");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          groups: [
            { id: "checkout", title: "Checkout", parentId: "application" },
            { id: "application", title: "Application", parentId: "checkout" },
          ],
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
        graph: {
          ...validDiagram.graph,
          nodes: [{ ...validDiagram.graph.nodes.at(0), type: "unknown" }],
        },
      }),
    ).toThrow("Invalid artifact");
    expect(() =>
      parseArtifact({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          edges: [{ ...validDiagram.graph.edges.at(0), type: "unknown" }],
        },
      }),
    ).toThrow("Invalid artifact");
  });

  it("validates lifeline messages and activation bounds", () => {
    const diagram = {
      ...validDiagram,
      graph: {
        ...validDiagram.graph,
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
    } as const;

    expect(parseArtifact(diagram)).toEqual(diagram);
    expect(() =>
      parseArtifact({
        ...diagram,
        graph: {
          ...diagram.graph,
          edges: [{ ...diagram.graph.edges.at(0), source: "missing" }, diagram.graph.edges.at(1)],
        },
      }),
    ).toThrow("Message edge request source must be a lifeline");
  });
});
