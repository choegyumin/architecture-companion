import type { AnnotationAnchor } from "@/features/annotation/annotation-document";
import { parseAnnotationDocument } from "@/features/annotation/annotation-document";

const anchor: AnnotationAnchor = {
  canvasId: "design:checkout-structure",
  point: { x: 120, y: 80 },
};

describe("annotation document", () => {
  test("restores both a selected diagram element target and an unselected position", () => {
    const documents = [
      undefined,
      { type: "group", id: "checkout-boundary" },
      { type: "node", id: "checkout-page" },
      { type: "edge", id: "submits-checkout" },
    ].map((target) => ({
      version: 1,
      annotations: [
        {
          id: "thread-1",
          anchor: {
            ...anchor,
            ...(target ? { target } : {}),
          },
          comment: {
            id: "comment-1",
            author: { id: "reviewer-1", name: "Ada" },
            body: "Review this element.",
            createdAt: "2026-08-28T00:00:00.000Z",
          },
        },
      ],
    }));

    expect(documents.map(parseAnnotationDocument)).toEqual(documents);
    expect(() =>
      parseAnnotationDocument({
        ...documents.at(0),
        annotations: [
          {
            ...documents.at(0)?.annotations.at(0),
            anchor: { ...anchor, target: { type: "unknown", id: "checkout-page" } },
          },
        ],
      }),
    ).toThrow("Invalid annotation document");
  });
});
