import type { CompanionCatalog } from "@/features/catalog/catalog";
import {
  parseArtifactSpotlight,
  validateSpotlightAgainstCatalog,
  type ArtifactSpotlight,
} from "@/features/spotlight/spotlight";

function catalog(): CompanionCatalog {
  return {
    behaviors: [
      {
        id: "checkout",
        title: "Checkout",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions: "## Purpose\nReview the checkout trigger.",
        layout: { id: "elk-layered" },
        graph: {
          groups: [{ id: "store", title: "Store" }],
          nodes: [
            { type: "default", id: "cart", kind: "page", title: "Cart", groupId: "store" },
            { type: "default", id: "pay", kind: "action", title: "Pay" },
          ],
          edges: [
            { type: "default", id: "e1", source: "cart", target: "pay" },
            { type: "default", id: "e2", source: "cart", target: "pay" },
          ],
        },
      },
    ],
    designs: [],
  };
}

function spotlight(diagram: ArtifactSpotlight["diagram"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram };
}

describe("parseArtifactSpotlight", () => {
  it("parses an artifact spotlight with diagram element targets", () => {
    expect(
      parseArtifactSpotlight({
        artifactId: "checkout",
        diagram: {
          elements: [
            { type: "node", id: "cart" },
            { type: "edge", id: "e1" },
          ],
        },
      }),
    ).toEqual({
      artifactId: "checkout",
      diagram: {
        elements: [
          { type: "node", id: "cart" },
          { type: "edge", id: "e1" },
        ],
      },
    });
  });

  it("accepts a spotlight without elements to show a whole artifact", () => {
    expect(parseArtifactSpotlight({ artifactId: "checkout", diagram: { elements: [] } })).toEqual({
      artifactId: "checkout",
      diagram: { elements: [] },
    });
  });

  it("rejects unknown fields and non-kebab artifact ids", () => {
    expect(() => parseArtifactSpotlight({ artifactId: "checkout", reason: "why" })).toThrow();
    expect(() => parseArtifactSpotlight({ artifactId: "Checkout", diagram: { elements: [] } })).toThrow();
  });
});

describe("validateSpotlightAgainstCatalog", () => {
  it("accepts existing groups, nodes, edges, and edge sets", () => {
    const result = validateSpotlightAgainstCatalog(
      catalog(),
      spotlight({
        elements: [
          { type: "group", id: "store" },
          { type: "node", id: "cart" },
          { type: "edge", id: "e1" },
          { type: "edge-set", sourceId: "cart", targetId: "pay", edgeIds: ["e1", "e2"] },
        ],
      }),
    );

    expect(result).toEqual({ status: "ok" });
  });

  it("rejects an unknown artifact", () => {
    const result = validateSpotlightAgainstCatalog(catalog(), { artifactId: "unknown", diagram: { elements: [] } });

    expect(result).toEqual({
      status: "invalid",
      message: "Spotlight references an unknown artifact: unknown",
    });
  });

  it("reports every unknown diagram element", () => {
    const result = validateSpotlightAgainstCatalog(
      catalog(),
      spotlight({
        elements: [
          { type: "node", id: "missing" },
          { type: "edge", id: "nope" },
          { type: "edge-set", sourceId: "cart", targetId: "ghost", edgeIds: ["e1", "gone"] },
        ],
      }),
    );

    expect(result).toMatchObject({ status: "invalid" });
    if (result.status !== "invalid") return;
    expect(result.message).toContain("Unknown diagram node: missing");
    expect(result.message).toContain("Unknown diagram edge: nope");
    expect(result.message).toContain("from cart to ghost");
    expect(result.message).toContain("Unknown diagram edge: gone");
  });
});
