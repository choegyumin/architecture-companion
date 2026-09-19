import { parseArtifact } from "@/features/artifact/artifact";

const validBehavior = {
  id: "checkout",
  title: "Checkout workflow",
  generatorId: "freeform",
  layout: { id: "elk-layered", options: { direction: "RIGHT" } },
  graph: {
    groups: [],
    nodes: [
      { id: "submit", type: "default", kind: "trigger", title: "Order submitted" },
      { id: "validate", type: "default", kind: "condition", title: "Payment valid?" },
      { id: "capture", type: "default", kind: "action", title: "Capture payment" },
      { id: "confirmed", type: "default", kind: "result", title: "Order confirmed" },
    ],
    edges: [
      { id: "submit-validate", type: "default", source: "submit", target: "validate" },
      { id: "validate-capture", type: "default", source: "validate", target: "capture", label: "Yes" },
      { id: "capture-confirmed", type: "default", source: "capture", target: "confirmed" },
    ],
  },
} as const;

const validArtifact = {
  behaviors: [validBehavior],
  designs: [],
} as const;

describe("artifact parsing", () => {
  it("preserves a valid diagram artifact", () => {
    expect(parseArtifact(validArtifact)).toEqual(validArtifact);
  });

  it("allows an artifact with no behaviors", () => {
    const artifact = { behaviors: [], designs: [] } as const;

    expect(parseArtifact(artifact)).toEqual(artifact);
  });

  it("preserves custom generator IDs regardless of installation", () => {
    const behavior = { ...validBehavior, generatorId: "dependency-graph" } as const;
    const artifact = { ...validArtifact, behaviors: [behavior] } as const;

    expect(parseArtifact(artifact)).toEqual(artifact);
  });

  it("rejects unknown fields", () => {
    expect(() => parseArtifact({ ...validArtifact, unexpected: true })).toThrow("Invalid artifact");
  });

  it("rejects unknown node and edge types", () => {
    const unknownNodeType = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          graph: {
            ...validBehavior.graph,
            nodes: [{ ...validBehavior.graph.nodes.at(0), type: "screen" }],
            edges: [],
          },
        },
      ],
    };
    const unknownEdgeType = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          graph: {
            ...validBehavior.graph,
            edges: [{ ...validBehavior.graph.edges.at(0), type: "transition" }],
          },
        },
      ],
    };

    expect(() => parseArtifact(unknownNodeType)).toThrow("Invalid artifact");
    expect(() => parseArtifact(unknownEdgeType)).toThrow("Invalid artifact");
  });

  it("rejects duplicate element IDs and dangling edges", () => {
    const duplicateNode = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          graph: {
            ...validBehavior.graph,
            nodes: [validBehavior.graph.nodes.at(0), validBehavior.graph.nodes.at(0)],
            edges: [],
          },
        },
      ],
    };
    const danglingEdge = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          graph: {
            ...validBehavior.graph,
            edges: [{ id: "missing", type: "default", source: "submit", target: "missing-node" }],
          },
        },
      ],
    };

    expect(() => parseArtifact(duplicateNode)).toThrow("Duplicate diagram element ID: submit");
    expect(() => parseArtifact(danglingEdge)).toThrow("Diagram edge missing targets unknown node missing-node");
  });

  it("rejects duplicate behavior IDs", () => {
    expect(() => parseArtifact({ ...validArtifact, behaviors: [validBehavior, validBehavior] })).toThrow(
      "Duplicate behavior ID: checkout",
    );
  });

  it("rejects duplicate design IDs", () => {
    const diagram = {
      id: "structure",
      title: "Structure",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    } as const;

    expect(() => parseArtifact({ ...validArtifact, designs: [diagram, diagram] })).toThrow(
      "Duplicate design ID: structure",
    );
  });

  it("preserves direct node links and edge hrefs", () => {
    const diagram = {
      id: "structure",
      title: "Structure",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          {
            id: "checkout-page",
            type: "default",
            kind: "component",
            title: "Checkout page",
            links: [{ href: "source:///src/checkout-page.tsx#L1-L20" }],
          },
          { id: "payment-client", type: "default", kind: "client", title: "Payment client" },
        ],
        edges: [
          {
            id: "uses-payment-client",
            type: "default",
            source: "checkout-page",
            target: "payment-client",
            label: "Uses payment client",
            href: "https://example.com/payment-client",
          },
        ],
      },
    } as const;

    expect(parseArtifact({ ...validArtifact, designs: [diagram] })).toEqual({
      ...validArtifact,
      designs: [diagram],
    });
  });
});
