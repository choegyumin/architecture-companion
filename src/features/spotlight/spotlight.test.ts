import type { CompanionCatalog } from "@/features/catalog/catalog";
import {
  type ArtifactSpotlight,
  parseArtifactSpotlight,
  validateSpotlightAgainstCatalog,
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
        diagram: {
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
      },
    ],
    designs: [],
  };
}

function spotlight(steps: ArtifactSpotlight["diagram"]["steps"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram: { steps } };
}

describe("parseArtifactSpotlight", () => {
  it("parses spotlight steps with diagram element targets and captions", () => {
    expect(
      parseArtifactSpotlight({
        artifactId: "checkout",
        diagram: {
          steps: [
            {
              elements: [
                { type: "node", id: "cart" },
                { type: "edge", id: "e1" },
              ],
              caption: "Cart starts checkout",
            },
            { elements: [{ type: "node", id: "pay" }] },
          ],
        },
      }),
    ).toEqual({
      artifactId: "checkout",
      diagram: {
        steps: [
          {
            elements: [
              { type: "node", id: "cart" },
              { type: "edge", id: "e1" },
            ],
            caption: "Cart starts checkout",
          },
          { elements: [{ type: "node", id: "pay" }] },
        ],
      },
    });
  });

  it("accepts a step without elements to show a whole artifact", () => {
    expect(parseArtifactSpotlight({ artifactId: "checkout", diagram: { steps: [{ elements: [] }] } })).toEqual({
      artifactId: "checkout",
      diagram: { steps: [{ elements: [] }] },
    });
  });

  it("rejects unknown fields, non-kebab artifact ids, and empty step lists", () => {
    expect(() => parseArtifactSpotlight({ artifactId: "checkout", reason: "why" })).toThrow();
    expect(() => parseArtifactSpotlight({ artifactId: "Checkout", diagram: { steps: [{ elements: [] }] } })).toThrow();
    expect(() => parseArtifactSpotlight({ artifactId: "checkout", diagram: { steps: [] } })).toThrow();
    expect(() =>
      parseArtifactSpotlight({ artifactId: "checkout", diagram: { steps: [{ elements: [], step: 1 }] } }),
    ).toThrow();
  });
});

describe("validateSpotlightAgainstCatalog", () => {
  it("accepts existing groups, nodes, edges, and edge sets across steps", () => {
    const result = validateSpotlightAgainstCatalog(
      catalog(),
      spotlight([
        { elements: [{ type: "group", id: "store" }], caption: "The store group" },
        {
          elements: [
            { type: "node", id: "cart" },
            { type: "edge", id: "e1" },
            { type: "edge-set", sourceId: "cart", targetId: "pay", edgeIds: ["e1", "e2"] },
          ],
        },
      ]),
    );

    expect(result).toEqual({ status: "ok" });
  });

  it("rejects an unknown artifact", () => {
    const result = validateSpotlightAgainstCatalog(catalog(), {
      artifactId: "unknown",
      diagram: { steps: [{ elements: [] }] },
    });

    expect(result).toEqual({
      status: "invalid",
      message: "Spotlight references an unknown artifact: unknown",
    });
  });

  it("reports every unknown diagram element with its step", () => {
    const result = validateSpotlightAgainstCatalog(
      catalog(),
      spotlight([
        { elements: [{ type: "node", id: "missing" }] },
        {
          elements: [
            { type: "edge", id: "nope" },
            { type: "edge-set", sourceId: "cart", targetId: "ghost", edgeIds: ["e1", "gone"] },
          ],
        },
      ]),
    );

    expect(result).toMatchObject({ status: "invalid" });
    if (result.status !== "invalid") return;
    expect(result.message).toContain("Step 1: unknown diagram node: missing");
    expect(result.message).toContain("Step 2: unknown diagram edge: nope");
    expect(result.message).toContain("from cart to ghost");
    expect(result.message).toContain("Step 2: unknown diagram edge: gone");
  });
});
