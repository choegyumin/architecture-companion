import { parseCatalog } from "@/features/catalog/catalog";

const validBehavior = {
  id: "checkout",
  title: "Checkout workflow",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview checkout payment flow.\n\n## Regeneration\nRebuild submission, validation, capture, and confirmation steps.",
  layout: { id: "elk-layered", options: { elk: { direction: "RIGHT" } } },
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

describe("catalog parsing", () => {
  it("preserves a valid diagram catalog", () => {
    expect(parseCatalog(validArtifact)).toEqual(validArtifact);
  });

  it.each([
    { revision: "r1842", divergesFromRevision: false },
    { revision: "6d8c2d3b21d2647166542072ba757b1b57d496cf", divergesFromRevision: true },
  ])("preserves authoring metadata in behaviors and designs: $revision", (vcs) => {
    const diagram = { ...validBehavior, vcs };
    const catalog = { behaviors: [diagram], designs: [diagram] };

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it.each([undefined, null, "", "not-a-date", "2026-10-03", "2026-10-03T09:15:00", "2026-10-03T09:15:00+09:00"])(
    "rejects a missing or non-UTC authoring timestamp: %s",
    (updatedAt) => {
      const catalog = { ...validArtifact, behaviors: [{ ...validBehavior, updatedAt }] };

      expect(() => parseCatalog(catalog)).toThrow("Invalid catalog");
    },
  );

  it.each([
    null,
    {},
    { revision: "r1842" },
    { divergesFromRevision: false },
    { revision: "", divergesFromRevision: false },
    { revision: "r1842", divergesFromRevision: "false" },
    { revision: "r1842", divergesFromRevision: false, dirty: true },
  ])("rejects incomplete or invalid VCS metadata: %j", (vcs) => {
    const catalog = { ...validArtifact, behaviors: [{ ...validBehavior, vcs }] };

    expect(() => parseCatalog(catalog)).toThrow("Invalid catalog");
  });

  it("allows an catalog with no behaviors", () => {
    const catalog = { behaviors: [], designs: [] } as const;

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("preserves custom generator IDs regardless of installation", () => {
    const behavior = { ...validBehavior, generator: "project:dependency-graph" } as const;
    const catalog = { ...validArtifact, behaviors: [behavior] } as const;

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("rejects unknown fields", () => {
    expect(() => parseCatalog({ ...validArtifact, unexpected: true })).toThrow("Invalid catalog");
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

    expect(() => parseCatalog(unknownNodeType)).toThrow("Invalid catalog");
    expect(() => parseCatalog(unknownEdgeType)).toThrow("Invalid catalog");
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

    expect(() => parseCatalog(duplicateNode)).toThrow("Duplicate diagram element ID: submit");
    expect(() => parseCatalog(danglingEdge)).toThrow("Diagram edge missing targets unknown node missing-node");
  });

  it("rejects duplicate behavior IDs", () => {
    expect(() => parseCatalog({ ...validArtifact, behaviors: [validBehavior, validBehavior] })).toThrow(
      "Duplicate behavior ID: checkout",
    );
  });

  it("rejects duplicate design IDs", () => {
    const diagram = {
      id: "structure",
      title: "Structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout component ownership.\n\n## Regeneration\nRebuild the checkout page and its dependencies.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    } as const;

    expect(() => parseCatalog({ ...validArtifact, designs: [diagram, diagram] })).toThrow(
      "Duplicate design ID: structure",
    );
  });

  it("preserves direct node links and edge hrefs", () => {
    const diagram = {
      id: "structure",
      title: "Structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout component ownership.\n\n## Regeneration\nRebuild the checkout page and its dependencies.",
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

    expect(parseCatalog({ ...validArtifact, designs: [diagram] })).toEqual({
      ...validArtifact,
      designs: [diagram],
    });
  });
});
