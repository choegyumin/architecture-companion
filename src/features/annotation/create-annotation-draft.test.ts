import type { AnnotationAnchor, AnnotationDocument } from "@/features/annotation/annotation-document";
import { parseAnnotationDocument } from "@/features/annotation/annotation-document";
import { createAnnotationDraft } from "@/features/annotation/create-annotation-draft";

const anchor: AnnotationAnchor = {
  canvasId: "design:checkout-structure",
  point: { x: 120, y: 80 },
};

describe("comment draft", () => {
  test("publishes a single comment on an annotation and restores the serialized document", async () => {
    let document: AnnotationDocument = { version: 1, annotations: [] };
    const ids = ["thread-1", "comment-1"];
    const annotations = createAnnotationDraft({
      repository: {
        load: async () => document,
        save: async (nextDocument) => {
          document = nextDocument;
        },
      },
      currentUser: {
        load: async () => ({ id: "reviewer-1", name: "Ada" }),
      },
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-08-28T00:00:00.000Z",
    });
    const draft = annotations.change(annotations.begin(anchor), "  Move this responsibility.  ");

    const result = await annotations.publish(draft);

    expect(result).toEqual({
      status: "published",
      document: {
        version: 1,
        annotations: [
          {
            id: "thread-1",
            anchor,
            comment: {
              id: "comment-1",
              author: { id: "reviewer-1", name: "Ada" },
              body: "Move this responsibility.",
              createdAt: "2026-08-28T00:00:00.000Z",
            },
          },
        ],
      },
      annotation: expect.objectContaining({ id: "thread-1", anchor }),
    });
    expect(parseAnnotationDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  test("begins and edits a draft, rejects the empty draft, and cancels without saving", async () => {
    let saved: AnnotationDocument | undefined;
    const annotations = createAnnotationDraft({
      repository: {
        load: async () => ({ version: 1, annotations: [] }),
        save: async (document) => {
          saved = document;
        },
      },
      currentUser: {
        load: async () => ({ id: "reviewer-1", name: "Ada" }),
      },
      createId: () => "unused",
      now: () => "2026-08-28T00:00:00.000Z",
    });

    const draft = annotations.begin(anchor);
    expect(draft).toEqual({ anchor, body: "" });

    const changedDraft = annotations.change(draft, "   ");
    await expect(annotations.publish(changedDraft)).resolves.toEqual({
      status: "invalid",
      draft: changedDraft,
      message: "Comment cannot be empty.",
    });
    expect(annotations.cancel(changedDraft)).toBeUndefined();
    expect(saved).toBeUndefined();
  });

  test("keeps the draft when saving fails", async () => {
    const annotations = createAnnotationDraft({
      repository: {
        load: async () => ({ version: 1, annotations: [] }),
        save: async () => {
          throw new Error("disk full");
        },
      },
      currentUser: {
        load: async () => ({ id: "reviewer-1", name: "Ada" }),
      },
      createId: () => "generated-id",
      now: () => "2026-08-28T00:00:00.000Z",
    });
    const draft = annotations.change(annotations.begin(anchor), "Keep this text");

    await expect(annotations.publish(draft)).resolves.toEqual({
      status: "error",
      draft,
      message: "Comment could not be saved. Try again.",
    });
  });
});
