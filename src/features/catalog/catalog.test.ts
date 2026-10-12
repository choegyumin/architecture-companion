import { catalogConfigSchema, parseCatalog } from "@/features/catalog/catalog";

it("parses artifact discovery patterns independently from placement instructions", () => {
  const config = {
    include: ["src/**/*.review.json"],
    placementInstructions: "Keep artifacts beside their feature.",
  };
  expect(catalogConfigSchema.parse(config)).toEqual(config);
});

const validBehavior = {
  artifactId: "src/checkout/checkout.archcomp.json",
  type: "behavior",
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

const validArtifact = { artifacts: [validBehavior] } as const;

describe("catalog parsing", () => {
  it.each([
    "/checkout.json",
    "../checkout.json",
    "src/../checkout.json",
    "src\\checkout.json",
    "C:/checkout.json",
    "src//checkout.json",
  ])("rejects an artifact path outside the normalized scope-relative contract: %s", (id) => {
    expect(() => parseCatalog({ artifacts: [{ ...validBehavior, id }] })).toThrow("Invalid catalog");
  });

  it("allows the same filename in different directories", () => {
    const catalog = {
      artifacts: [validBehavior, { ...validBehavior, artifactId: "src/account/checkout.archcomp.json" }],
    };
    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("preserves artifact types and order in a single catalog collection", () => {
    const catalog = {
      artifacts: [{ ...validBehavior, type: "design", artifactId: "src/checkout/design.archcomp.json" }, validBehavior],
    };
    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("rejects the same path for different artifact types", () => {
    expect(() => parseCatalog({ artifacts: [validBehavior, { ...validBehavior, type: "design" }] })).toThrow(
      "Duplicate artifact path: src/checkout/checkout.archcomp.json",
    );
  });

  it("preserves a valid diagram catalog", () => {
    expect(parseCatalog(validArtifact)).toEqual(validArtifact);
  });

  it.each([
    { revision: "r1842", divergesFromRevision: false },
    { revision: "6d8c2d3b21d2647166542072ba757b1b57d496cf", divergesFromRevision: true },
  ])("preserves authoring metadata in artifacts: $revision", (vcs) => {
    const diagram = { ...validBehavior, vcs };
    const catalog = {
      artifacts: [diagram, { ...diagram, type: "design", artifactId: "src/checkout/design.archcomp.json" }],
    };

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it.each([undefined, null, "", "not-a-date", "2026-10-03", "2026-10-03T09:15:00", "2026-10-03T09:15:00+09:00"])(
    "rejects a missing or non-UTC authoring timestamp: %s",
    (updatedAt) => {
      const catalog = { ...validArtifact, artifacts: [{ ...validBehavior, updatedAt }] };

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
    const catalog = { ...validArtifact, artifacts: [{ ...validBehavior, vcs }] };

    expect(() => parseCatalog(catalog)).toThrow("Invalid catalog");
  });

  it("allows an empty catalog", () => {
    const catalog = { artifacts: [] } as const;

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("preserves custom generator IDs regardless of installation", () => {
    const behavior = { ...validBehavior, generator: "project:dependency-graph" } as const;
    const catalog = { ...validArtifact, artifacts: [behavior] } as const;

    expect(parseCatalog(catalog)).toEqual(catalog);
  });

  it("rejects unknown fields", () => {
    expect(() => parseCatalog({ ...validArtifact, unexpected: true })).toThrow("Invalid catalog");
  });

  it("rejects unknown node and edge types", () => {
    const unknownNodeType = {
      ...validArtifact,
      artifacts: [
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
      artifacts: [
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
      artifacts: [
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
      artifacts: [
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

  it.each(["behavior", "design"])("rejects duplicate artifact paths for %s", (type) => {
    const artifact = { ...validBehavior, type };
    expect(() => parseCatalog({ artifacts: [artifact, artifact] })).toThrow(
      "Duplicate artifact path: src/checkout/checkout.archcomp.json",
    );
  });

  it("preserves direct node links and edge hrefs", () => {
    const diagram = {
      artifactId: "src/checkout/structure.archcomp.json",
      type: "design",
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

    const catalog = { artifacts: [...validArtifact.artifacts, diagram] };
    expect(parseCatalog(catalog)).toEqual(catalog);
  });
});
