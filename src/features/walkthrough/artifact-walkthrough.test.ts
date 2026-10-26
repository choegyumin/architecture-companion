import { describe, expect, it } from "vitest";

import type { CompanionCatalog } from "@/features/catalog/catalog";
import {
  type ArtifactWalkthrough,
  artifactWalkthroughSchema,
  decodeArtifactWalkthrough,
  encodeArtifactWalkthrough,
  parseArtifactWalkthrough,
  validateWalkthroughAgainstCatalog,
} from "@/features/walkthrough/artifact-walkthrough";

const artifactId = ".architecture-companion/artifacts/checkout-workflow.archcomp.json";

const walkthrough: ArtifactWalkthrough = {
  artifactId,
  diagram: {
    steps: [
      {
        elements: [
          { type: "node", id: "submit" },
          { type: "edge", id: "confirm" },
          { type: "group", id: "checkout" },
          { type: "edge-set", sourceId: "checkout", targetId: "submit", edgeIds: ["confirm"] },
        ],
        caption: "The checkout flow from request to confirmation.",
      },
      { elements: [], caption: "The whole artifact." },
    ],
  },
};

function catalog(): CompanionCatalog {
  return {
    artifacts: [
      {
        title: "Workflow",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions: "## Purpose\nReview the checkout trigger.",
        diagram: {
          layout: { layoutId: "general" },
          graph: {
            groups: [{ synthetic: false, type: "default", groupId: "checkout", title: "Checkout" }],
            nodes: [
              { synthetic: false, type: "default", nodeId: "submit", kind: "trigger", title: "Submit" },
              { synthetic: false, type: "default", nodeId: "receipt", kind: "page", title: "Receipt" },
            ],
            edges: [
              { type: "default", edgeId: "confirm", sourceNodeId: "submit", targetNodeId: "receipt", label: "Confirm" },
            ],
          },
        },
        artifactId,
        type: "behavior",
      },
    ],
  };
}

describe("artifact walkthrough contract", () => {
  it("parses a complete walkthrough and exposes it through the schema", () => {
    expect(parseArtifactWalkthrough(walkthrough)).toEqual(walkthrough);
    expect(artifactWalkthroughSchema.safeParse(walkthrough).success).toBe(true);
  });

  it("rejects an unknown field with its path", () => {
    expect(() => parseArtifactWalkthrough({ ...walkthrough, extra: true })).toThrow(
      'Invalid artifact walkthrough: Unrecognized key: "extra"',
    );
  });

  it("requires a caption on every step and names the failing step index", () => {
    const input = {
      artifactId,
      diagram: { steps: [{ elements: [], caption: "First." }, { elements: [] }] },
    };

    expect(() => parseArtifactWalkthrough(input)).toThrow(
      "Invalid artifact walkthrough: diagram.steps[1].caption: Invalid input: expected string, received undefined",
    );
  });

  it("rejects a walkthrough without steps", () => {
    expect(() => parseArtifactWalkthrough({ artifactId, diagram: { steps: [] } })).toThrow(
      "Invalid artifact walkthrough: diagram.steps: Too small: expected array to have >=1 items",
    );
  });

  it("rejects an element shape outside the Annotation target contract", () => {
    const input = {
      artifactId,
      diagram: { steps: [{ elements: [{ type: "node", id: "" }], caption: "Step." }] },
    };

    expect(() => parseArtifactWalkthrough(input)).toThrow(
      "Invalid artifact walkthrough: diagram.steps[0].elements[0].id: Too small: expected string to have >=1 characters",
    );
  });

  it("round-trips a walkthrough, including non-ASCII captions, as unpadded base64url", () => {
    const encoded = encodeArtifactWalkthrough({
      ...walkthrough,
      diagram: { steps: [{ elements: [], caption: "결제 흐름을 살펴봅시다." }] },
    });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeArtifactWalkthrough(encoded)).toEqual({
      ...walkthrough,
      diagram: { steps: [{ elements: [], caption: "결제 흐름을 살펴봅시다." }] },
    });
  });

  it("rejects a padded or otherwise non-canonical base64url param", () => {
    const encoded = encodeArtifactWalkthrough(walkthrough);
    expect(decodeArtifactWalkthrough(`${encoded}=`)).toBeUndefined();
    expect(decodeArtifactWalkthrough(`${encoded}==`)).toBeUndefined();
    expect(decodeArtifactWalkthrough("+w")).toBeUndefined();
    expect(decodeArtifactWalkthrough("/w")).toBeUndefined();
  });

  it("returns undefined for a param that is not a decodable walkthrough", () => {
    expect(decodeArtifactWalkthrough("!!not-base64url!!")).toBeUndefined();
    expect(decodeArtifactWalkthrough(Buffer.from("not json", "utf8").toString("base64url"))).toBeUndefined();
    expect(
      decodeArtifactWalkthrough(
        Buffer.from(JSON.stringify({ artifactId, diagram: { steps: [{ elements: [] }] } }), "utf8").toString(
          "base64url",
        ),
      ),
    ).toBeUndefined();
  });

  it("accepts a walkthrough whose every element exists in the catalog", () => {
    expect(validateWalkthroughAgainstCatalog(catalog(), walkthrough)).toEqual({ status: "ok" });
  });

  it("rejects a walkthrough for an unknown artifact", () => {
    const result = validateWalkthroughAgainstCatalog(catalog(), {
      ...walkthrough,
      artifactId: ".architecture-companion/artifacts/missing.archcomp.json",
    });

    expect(result).toEqual({
      status: "invalid",
      message: "Walkthrough references an unknown artifact: .architecture-companion/artifacts/missing.archcomp.json",
    });
  });

  it("names the step and element when a walkthrough addresses unknown diagram elements", () => {
    const result = validateWalkthroughAgainstCatalog(catalog(), {
      artifactId,
      diagram: {
        steps: [
          {
            elements: [
              { type: "node", id: "nope" },
              { type: "edge", id: "nope-edge" },
              { type: "group", id: "nope-group" },
            ],
            caption: "Step.",
          },
        ],
      },
    });

    expect(result).toEqual({
      status: "invalid",
      message:
        "Walkthrough does not match artifact .architecture-companion/artifacts/checkout-workflow.archcomp.json: " +
        "Step 1: unknown diagram node: nope; Step 1: unknown diagram edge: nope-edge; Step 1: unknown diagram group: nope-group",
    });
  });

  it("requires edge-set endpoints to be existing groups or nodes and its edges to exist", () => {
    const result = validateWalkthroughAgainstCatalog(catalog(), {
      artifactId,
      diagram: {
        steps: [
          {
            elements: [
              { type: "edge-set", sourceId: "checkout", targetId: "missing-endpoint", edgeIds: ["missing-edge"] },
            ],
            caption: "Step.",
          },
        ],
      },
    });

    expect(result).toEqual({
      status: "invalid",
      message:
        "Walkthrough does not match artifact .architecture-companion/artifacts/checkout-workflow.archcomp.json: " +
        "Step 1: edge-set endpoints must be existing groups or nodes: from checkout to missing-endpoint; " +
        "Step 1: unknown diagram edge: missing-edge",
    });
  });
});
