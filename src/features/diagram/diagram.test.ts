import { parseDiagram } from "@/features/diagram/diagram";

const validDiagram = {
  id: "checkout-structure",
  title: "Checkout structure",
  generator: "built-in:freeform",
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

describe("diagram parsing", () => {
  it("preserves the common diagram contract", () => {
    expect(parseDiagram(validDiagram)).toEqual(validDiagram);
  });

  it("preserves diagram-level links", () => {
    const diagram = {
      ...validDiagram,
      links: [{ text: "Workflow review test", href: "source:///specs/review-architecture.spec.tsx" }],
    } as const;

    expect(parseDiagram(diagram)).toEqual(diagram);
  });

  it("preserves free-form generator instructions for reproducible regeneration", () => {
    const diagram = {
      ...validDiagram,
      generatorInstructions: "Regenerate from the consumer scope root using tsconfig.json and the selected src tree.",
    } as const;

    expect(parseDiagram(diagram)).toEqual(diagram);
  });

  it("preserves provider-owned layout options", () => {
    const diagram = {
      ...validDiagram,
      layout: { id: "elk-layered", options: { direction: "RIGHT" } },
    };

    expect(parseDiagram(diagram)).toEqual(diagram);
  });

  it("parses supported layout configurations", () => {
    expect(parseDiagram(validSequenceDiagram).layout).toEqual({ id: "sequence" });
  });

  it("rejects unsupported layout configurations", () => {
    expect(() => parseDiagram({ ...validDiagram, layout: { id: "unknown" } })).toThrow("Invalid diagram");
    expect(() =>
      parseDiagram({ ...validDiagram, layout: { id: "elk-layered", options: { direction: "DIAGONAL" } } }),
    ).toThrow("Invalid diagram");
    expect(() => parseDiagram({ ...validDiagram, layout: { id: "elk-layered", options: { spacing: 24 } } })).toThrow(
      "Invalid diagram",
    );
    expect(() => parseDiagram({ ...validDiagram, layout: { id: "sequence", options: {} } })).toThrow("Invalid diagram");
  });

  test("sequence diagrams do not allow groups", () => {
    expect(() =>
      parseDiagram({
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
      parseDiagram({
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
      parseDiagram({
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
      parseDiagram({
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
      parseDiagram({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          edges: [{ ...validDiagram.graph.edges.at(0), id: "checkout-page" }],
        },
      }),
    ).toThrow("Duplicate diagram element ID: checkout-page");
    expect(() =>
      parseDiagram({
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
      parseDiagram({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          nodes: [{ ...validDiagram.graph.nodes.at(0), groupId: "missing" }],
          edges: [],
        },
      }),
    ).toThrow("Diagram node checkout-page belongs to unknown group missing");
    expect(() =>
      parseDiagram({
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

      expect(parseDiagram(diagram)).toEqual(diagram);
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
    expect(() => parseDiagram({ ...validDiagram, generator })).toThrow("Invalid diagram");
  });

  it("rejects unknown renderer types", () => {
    expect(() =>
      parseDiagram({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          nodes: [{ ...validDiagram.graph.nodes.at(0), type: "unknown" }],
        },
      }),
    ).toThrow("Invalid diagram");
    expect(() =>
      parseDiagram({
        ...validDiagram,
        graph: {
          ...validDiagram.graph,
          edges: [{ ...validDiagram.graph.edges.at(0), type: "unknown" }],
        },
      }),
    ).toThrow("Invalid diagram");
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

    expect(parseDiagram(diagram)).toEqual(diagram);
    expect(() =>
      parseDiagram({
        ...diagram,
        graph: {
          ...diagram.graph,
          edges: [{ ...diagram.graph.edges.at(0), source: "missing" }, diagram.graph.edges.at(1)],
        },
      }),
    ).toThrow("Message edge request source must be a lifeline");
  });
});
