import type {
  Annotation,
  AnnotationAnchor,
  AnnotationDocument,
  CommentAuthor,
} from "@/features/annotation/annotation-document";

export type AnnotationDraft = Readonly<{
  anchor: AnnotationAnchor;
  body: string;
}>;

export type AnnotationRepository = Readonly<{
  load: () => Promise<AnnotationDocument>;
  save: (document: AnnotationDocument, expectedDocument: AnnotationDocument) => Promise<void>;
}>;

export type CurrentUser = Readonly<{
  load: () => Promise<CommentAuthor>;
}>;

type CreateAnnotationDraftDependencies = Readonly<{
  repository: AnnotationRepository;
  currentUser: CurrentUser;
  createId: () => string;
  now: () => string;
}>;

type PublishResult =
  | Readonly<{ status: "invalid"; draft: AnnotationDraft; message: string }>
  | Readonly<{ status: "published"; document: AnnotationDocument; annotation: Annotation }>
  | Readonly<{ status: "error"; draft: AnnotationDraft; message: string }>;

export function createAnnotationDraft(dependencies: CreateAnnotationDraftDependencies) {
  return {
    begin: (anchor: AnnotationAnchor): AnnotationDraft => ({ anchor, body: "" }),
    change: (draft: AnnotationDraft, body: string): AnnotationDraft => ({ ...draft, body }),
    cancel: (_draft: AnnotationDraft): undefined => undefined,
    publish: async (draft: AnnotationDraft): Promise<PublishResult> => {
      const body = draft.body.trim();
      if (body.length === 0) {
        return { status: "invalid", draft, message: "Comment cannot be empty." };
      }

      try {
        const [document, author] = await Promise.all([dependencies.repository.load(), dependencies.currentUser.load()]);
        const annotation: Annotation = {
          id: dependencies.createId(),
          anchor: draft.anchor,
          comment: {
            id: dependencies.createId(),
            author,
            body,
            createdAt: dependencies.now(),
          },
        };
        const nextDocument: AnnotationDocument = {
          ...document,
          annotations: [...document.annotations, annotation],
        };

        await dependencies.repository.save(nextDocument, document);

        return { status: "published", document: nextDocument, annotation };
      } catch {
        return { status: "error", draft, message: "Comment could not be saved. Try again." };
      }
    },
  };
}
