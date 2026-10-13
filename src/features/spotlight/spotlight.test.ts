import type { CompanionCatalog } from "@/features/catalog/catalog";
import {
  type ArtifactSpotlight,
  decodeSpotlightParam,
  encodeSpotlightParam,
  parseArtifactSpotlight,
  validateSpotlightAgainstCatalog,
} from "@/features/spotlight/spotlight";

const checkoutArtifactId = ".architecture-companion/artifacts/checkout.archcomp.json";

function catalog(): CompanionCatalog {
  return {
    artifacts: [
      {
        artifactId: checkoutArtifactId,
        type: "behavior",
        title: "Checkout",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions: "## Purpose\nReview the checkout trigger.",
        diagram: {
          layout: { layoutId: "elk-layered" },
          graph: {
            groups: [{ groupId: "store", title: "Store" }],
            nodes: [
              { type: "default", nodeId: "cart", kind: "page", title: "Cart", groupId: "store" },
              { type: "default", nodeId: "pay", kind: "action", title: "Pay" },
            ],
            edges: [
              { type: "default", edgeId: "e1", sourceNodeId: "cart", targetNodeId: "pay" },
              { type: "default", edgeId: "e2", sourceNodeId: "cart", targetNodeId: "pay" },
            ],
          },
        },
      },
    ],
  };
}

function spotlight(steps: ArtifactSpotlight["diagram"]["steps"]): ArtifactSpotlight {
  return { artifactId: checkoutArtifactId, diagram: { steps } };
}

describe("parseArtifactSpotlight", () => {
  it("parses spotlight steps with diagram element targets and captions", () => {
    expect(
      parseArtifactSpotlight({
        artifactId: checkoutArtifactId,
        diagram: {
          steps: [
            {
              elements: [
                { type: "node", id: "cart" },
                { type: "edge", id: "e1" },
              ],
              caption: "Cart starts checkout",
            },
            { elements: [{ type: "node", id: "pay" }], caption: "Pay takes over" },
          ],
        },
      }),
    ).toEqual({
      artifactId: checkoutArtifactId,
      diagram: {
        steps: [
          {
            elements: [
              { type: "node", id: "cart" },
              { type: "edge", id: "e1" },
            ],
            caption: "Cart starts checkout",
          },
          { elements: [{ type: "node", id: "pay" }], caption: "Pay takes over" },
        ],
      },
    });
  });

  it("accepts a step without elements to show a whole artifact", () => {
    expect(
      parseArtifactSpotlight({
        artifactId: checkoutArtifactId,
        diagram: { steps: [{ elements: [], caption: "All" }] },
      }),
    ).toEqual({
      artifactId: checkoutArtifactId,
      diagram: { steps: [{ elements: [], caption: "All" }] },
    });
  });

  it("rejects unknown fields, non-relative artifact ids, empty step lists, and captionless steps", () => {
    expect(() => parseArtifactSpotlight({ artifactId: checkoutArtifactId, reason: "why" })).toThrow();
    expect(() =>
      parseArtifactSpotlight({ artifactId: "/checkout", diagram: { steps: [{ elements: [], caption: "Why" }] } }),
    ).toThrow();
    expect(() => parseArtifactSpotlight({ artifactId: checkoutArtifactId, diagram: { steps: [] } })).toThrow();
    expect(() =>
      parseArtifactSpotlight({ artifactId: checkoutArtifactId, diagram: { steps: [{ elements: [], step: 1 }] } }),
    ).toThrow();
    expect(() =>
      parseArtifactSpotlight({ artifactId: checkoutArtifactId, diagram: { steps: [{ elements: [] }] } }),
    ).toThrow();
  });

  it("names the offending field when a step is rejected", () => {
    expect(() =>
      parseArtifactSpotlight({ artifactId: checkoutArtifactId, diagram: { steps: [{ elements: [] }] } }),
    ).toThrow(/diagram\.steps\[0\]\.caption/);
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
          caption: "Cart fans out to Pay",
        },
      ]),
    );

    expect(result).toEqual({ status: "ok" });
  });

  it("rejects an unknown artifact", () => {
    const result = validateSpotlightAgainstCatalog(catalog(), {
      artifactId: "unknown",
      diagram: { steps: [{ elements: [], caption: "Ghost artifact" }] },
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
        { elements: [{ type: "node", id: "missing" }], caption: "Missing node" },
        {
          elements: [
            { type: "edge", id: "nope" },
            { type: "edge-set", sourceId: "cart", targetId: "ghost", edgeIds: ["e1", "gone"] },
          ],
          caption: "Ghost edges",
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

describe("spotlight URL param", () => {
  it("round-trips a spotlight through the base64url param", () => {
    const value = spotlight([
      { elements: [{ type: "node", id: "cart" }], caption: "장바구니에서 시작" },
      { elements: [{ type: "edge", id: "e1" }], caption: "결제로 흐른다" },
    ]);

    const param = encodeSpotlightParam(value);

    expect(param).toMatch(/^[\w-]+$/);
    expect(decodeSpotlightParam(param)).toEqual(value);
  });

  it("drops undecodable params", () => {
    expect(decodeSpotlightParam("not-base64url-$$$")).toBeUndefined();
    const broken = encodeSpotlightParam(spotlight([{ elements: [], caption: "x" }])).slice(0, 10);
    expect(decodeSpotlightParam(broken)).toBeUndefined();
  });

  it("drops params whose JSON fails the spotlight schema", () => {
    const json = JSON.stringify({ artifactId: "a.json", diagram: { steps: [{ elements: [] }] } });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const param = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
    expect(decodeSpotlightParam(param)).toBeUndefined();
  });
});
