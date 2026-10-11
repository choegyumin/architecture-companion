import { catalogConfigSchema, parseCatalog } from "@/features/catalog/catalog";

it("parses artifact discovery patterns independently from placement instructions", () => {
  const config = {
    artifactPatterns: ["src/**/*.review.json"],
    placementInstructions: "Keep artifacts beside their feature.",
  };
  expect(catalogConfigSchema.parse(config)).toEqual(config);
});

const validBehavior = {
  artifactId: "src/checkout/checkout.archcomp.json",
  kind: "behavior",
  title: "Checkout workflow",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview checkout payment flow.\n\n## Regeneration\nRebuild submission, validation, capture, and confirmation steps.",
  diagram: {
    layout: { layoutId: "elk-layered", options: { elk: { direction: "RIGHT" } } },
    graph: {
      groups: [],
      nodes: [
        { nodeId: "submit", type: "default", kind: "trigger", title: "Order submitted" },
        { nodeId: "validate", type: "default", kind: "condition", title: "Payment valid?" },
        { nodeId: "capture", type: "default", kind: "action", title: "Capture payment" },
        { nodeId: "confirmed", type: "default", kind: "result", title: "Order confirmed" },
      ],
      edges: [
        { edgeId: "submit-validate", type: "default", sourceNodeId: "submit", targetNodeId: "validate" },
        {
          edgeId: "validate-capture",
          type: "default",
          sourceNodeId: "validate",
          targetNodeId: "capture",
          label: "Yes",
        },
        { edgeId: "capture-confirmed", type: "default", sourceNodeId: "capture", targetNodeId: "confirmed" },
      ],
    },
  },
} as const;

const validArtifact = {
  behaviors: [validBehavior],
  designs: [],
} as const;

describe("catalog parsing", () => {
  it.each([
    "/checkout.json",
    "../checkout.json",
    "src/../checkout.json",
    "src\\checkout.json",
    "C:/checkout.json",
    "src//checkout.json",
  ])("rejects an artifact path outside the normalized scope-relative contract: %s", (id) => {
    expect(() => parseCatalog({ behaviors: [{ ...validBehavior, id }], designs: [] })).toThrow("Invalid catalog");
  });

  it("allows the same filename in different directories", () => {
    const catalog = {
      behaviors: [validBehavior, { ...validBehavior, artifactId: "src/account/checkout.archcomp.json" }],
      designs: [],
    };
    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("rejects a kind that disagrees with its collection", () => {
    expect(() => parseCatalog({ behaviors: [], designs: [validBehavior] })).toThrow(
      "Artifact kind does not match design collection",
    );
  });

  it("rejects the same path across collections", () => {
    expect(() => parseCatalog({ behaviors: [validBehavior], designs: [{ ...validBehavior, kind: "design" }] })).toThrow(
      "Duplicate artifact path: src/checkout/checkout.archcomp.json",
    );
  });

  it("preserves a valid diagram catalog", () => {
    expect(parseCatalog(validArtifact)).toEqual(validArtifact);
  });

  it.each([
    { revision: "r1842", divergesFromRevision: false },
    { revision: "6d8c2d3b21d2647166542072ba757b1b57d496cf", divergesFromRevision: true },
  ])("preserves authoring metadata in behaviors and designs: $revision", (vcs) => {
    const diagram = { ...validBehavior, vcs };
    const catalog = {
      behaviors: [diagram],
      designs: [{ ...diagram, kind: "design", artifactId: "src/checkout/design.archcomp.json" }],
    };

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
          diagram: {
            ...validBehavior.diagram,
            graph: {
              ...validBehavior.diagram.graph,
              nodes: [{ ...validBehavior.diagram.graph.nodes.at(0), type: "screen" }],
              edges: [],
            },
          },
        },
      ],
    };
    const unknownEdgeType = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          diagram: {
            ...validBehavior.diagram,
            graph: {
              ...validBehavior.diagram.graph,
              edges: [{ ...validBehavior.diagram.graph.edges.at(0), type: "transition" }],
            },
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
          diagram: {
            ...validBehavior.diagram,
            graph: {
              ...validBehavior.diagram.graph,
              nodes: [validBehavior.diagram.graph.nodes.at(0), validBehavior.diagram.graph.nodes.at(0)],
              edges: [],
            },
          },
        },
      ],
    };
    const danglingEdge = {
      ...validArtifact,
      behaviors: [
        {
          ...validBehavior,
          diagram: {
            ...validBehavior.diagram,
            graph: {
              ...validBehavior.diagram.graph,
              edges: [{ edgeId: "missing", type: "default", sourceNodeId: "submit", targetNodeId: "missing-node" }],
            },
          },
        },
      ],
    };

    expect(() => parseCatalog(duplicateNode)).toThrow("Duplicate diagram element ID: submit");
    expect(() => parseCatalog(danglingEdge)).toThrow("Diagram edge missing targets unknown node missing-node");
  });

  it("rejects duplicate behavior IDs", () => {
    expect(() => parseCatalog({ ...validArtifact, behaviors: [validBehavior, validBehavior] })).toThrow(
      "Duplicate artifact path: src/checkout/checkout.archcomp.json",
    );
  });

  it("rejects duplicate design IDs", () => {
    const diagram = {
      artifactId: "src/checkout/structure.archcomp.json",
      kind: "design",
      title: "Structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout component ownership.\n\n## Regeneration\nRebuild the checkout page and its dependencies.",
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ nodeId: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
          edges: [],
        },
      },
    } as const;

    expect(() => parseCatalog({ ...validArtifact, designs: [diagram, diagram] })).toThrow(
      "Duplicate artifact path: src/checkout/structure.archcomp.json",
    );
  });

  it("preserves direct node links and edge hrefs", () => {
    const diagram = {
      artifactId: "src/checkout/structure.archcomp.json",
      kind: "design",
      title: "Structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout component ownership.\n\n## Regeneration\nRebuild the checkout page and its dependencies.",
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [
            {
              nodeId: "checkout-page",
              type: "default",
              kind: "component",
              title: "Checkout page",
              links: [{ href: "source:///src/checkout-page.tsx#L1-L20" }],
            },
            { nodeId: "payment-client", type: "default", kind: "client", title: "Payment client" },
          ],
          edges: [
            {
              edgeId: "uses-payment-client",
              type: "default",
              sourceNodeId: "checkout-page",
              targetNodeId: "payment-client",
              label: "Uses payment client",
              href: "https://example.com/payment-client",
            },
          ],
        },
      },
    } as const;

    expect(parseCatalog({ ...validArtifact, designs: [diagram] })).toEqual({
      ...validArtifact,
      designs: [diagram],
    });
  });
});
