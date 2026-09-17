import type { AnnotationAnchor, AnnotationDocument } from "@/features/annotation/annotation-document";
import { createAnnotations } from "@/features/annotation/manage-annotations";

const anchor: AnnotationAnchor = {
  canvasId: "design:checkout-structure",
  point: { x: 120, y: 80 },
};

const publishedDocument: AnnotationDocument = {
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
};

describe("annotation management", () => {
  test("edits a published annotation without changing its identity or anchor", async () => {
    let document = publishedDocument;
    const annotations = createAnnotations({
      repository: {
        load: async () => document,
        save: async (nextDocument) => {
          document = nextDocument;
        },
      },
    });

    await expect(annotations.update("thread-1", "   ")).resolves.toEqual({
      status: "invalid",
      message: "Comment cannot be empty.",
    });
    const result = await annotations.update("thread-1", "  Keep this responsibility here.  ");

    expect(result).toEqual({
      status: "updated",
      document: {
        annotations: [
          {
            ...publishedDocument.annotations.at(0),
            comment: {
              ...publishedDocument.annotations.at(0)?.comment,
              body: "Keep this responsibility here.",
            },
          },
        ],
      },
    });
    expect(publishedDocument.annotations.at(0)?.comment.body).toBe("Move this responsibility.");
  });

  test("deletes a published annotation", async () => {
    let document = publishedDocument;
    const annotations = createAnnotations({
      repository: {
        load: async () => document,
        save: async (nextDocument) => {
          document = nextDocument;
        },
      },
    });

    const result = await annotations.remove("thread-1");

    expect(result).toEqual({ status: "deleted", document: { annotations: [] } });
    expect(document).toEqual({ annotations: [] });
  });

  test("moves a published annotation without changing its identity or content", async () => {
    let document = publishedDocument;
    const annotations = createAnnotations({
      repository: {
        load: async () => document,
        save: async (nextDocument) => {
          document = nextDocument;
        },
      },
    });

    const result = await annotations.move("thread-1", { x: 260, y: 180 });

    expect(result).toEqual({
      status: "moved",
      document: {
        annotations: [
          {
            ...publishedDocument.annotations.at(0),
            anchor: { ...anchor, point: { x: 260, y: 180 } },
          },
        ],
      },
    });
    expect(publishedDocument.annotations.at(0)?.anchor.point).toEqual({ x: 120, y: 80 });
  });

  test("keeps the last saved annotation when a management save fails", async () => {
    const annotations = createAnnotations({
      repository: {
        load: async () => publishedDocument,
        save: async () => {
          throw new Error("disk full");
        },
      },
    });

    await expect(annotations.update("thread-1", "Changed text")).resolves.toEqual({
      status: "error",
      message: "Comment could not be updated. Try again.",
    });
    await expect(annotations.remove("thread-1")).resolves.toEqual({
      status: "error",
      message: "Comment could not be deleted. Try again.",
    });
    await expect(annotations.move("thread-1", { x: 260, y: 180 })).resolves.toEqual({
      status: "error",
      message: "Comment could not be moved. Try again.",
    });
    expect(publishedDocument.annotations.at(0)).toEqual({
      id: "thread-1",
      anchor,
      comment: {
        id: "comment-1",
        author: { id: "reviewer-1", name: "Ada" },
        body: "Move this responsibility.",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    });
  });
});
