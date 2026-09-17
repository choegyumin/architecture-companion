import type { AnnotationAnchor, AnnotationDocument } from "@/features/annotation/annotation-document";
import type { AnnotationRepository } from "@/features/annotation/create-annotation-draft";

type AnnotationDependencies = Readonly<{
  repository: AnnotationRepository;
}>;

type UpdateResult =
  | Readonly<{ status: "invalid"; message: string }>
  | Readonly<{ status: "updated"; document: AnnotationDocument }>
  | Readonly<{ status: "error"; message: string }>;

type RemoveResult =
  Readonly<{ status: "deleted"; document: AnnotationDocument }> | Readonly<{ status: "error"; message: string }>;

type MoveResult =
  Readonly<{ status: "moved"; document: AnnotationDocument }> | Readonly<{ status: "error"; message: string }>;

export function createAnnotations(dependencies: AnnotationDependencies) {
  return {
    update: async (annotationId: string, body: string): Promise<UpdateResult> => {
      const nextBody = body.trim();
      if (nextBody.length === 0) {
        return { status: "invalid", message: "Comment cannot be empty." };
      }

      try {
        const document = await dependencies.repository.load();
        if (!document.annotations.some((annotation) => annotation.id === annotationId)) {
          return { status: "error", message: "Comment no longer exists." };
        }

        const nextDocument: AnnotationDocument = {
          ...document,
          annotations: document.annotations.map((annotation) =>
            annotation.id === annotationId
              ? {
                  ...annotation,
                  comment: { ...annotation.comment, body: nextBody },
                }
              : annotation,
          ),
        };

        await dependencies.repository.save(nextDocument, document);
        return { status: "updated", document: nextDocument };
      } catch {
        return { status: "error", message: "Comment could not be updated. Try again." };
      }
    },
    remove: async (annotationId: string): Promise<RemoveResult> => {
      try {
        const document = await dependencies.repository.load();
        if (!document.annotations.some((annotation) => annotation.id === annotationId)) {
          return { status: "error", message: "Comment no longer exists." };
        }

        const nextDocument: AnnotationDocument = {
          ...document,
          annotations: document.annotations.filter((annotation) => annotation.id !== annotationId),
        };

        await dependencies.repository.save(nextDocument, document);
        return { status: "deleted", document: nextDocument };
      } catch {
        return { status: "error", message: "Comment could not be deleted. Try again." };
      }
    },
    move: async (annotationId: string, point: AnnotationAnchor["point"]): Promise<MoveResult> => {
      try {
        const document = await dependencies.repository.load();
        if (!document.annotations.some((annotation) => annotation.id === annotationId)) {
          return { status: "error", message: "Comment no longer exists." };
        }

        const nextDocument: AnnotationDocument = {
          ...document,
          annotations: document.annotations.map((annotation) =>
            annotation.id === annotationId ? { ...annotation, anchor: { ...annotation.anchor, point } } : annotation,
          ),
        };

        await dependencies.repository.save(nextDocument, document);
        return { status: "moved", document: nextDocument };
      } catch {
        return { status: "error", message: "Comment could not be moved. Try again." };
      }
    },
  };
}
