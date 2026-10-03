import { z } from "zod";

import { type AnnotationDocument, annotationDocumentSchema } from "@/features/annotation/annotation-document";
import {
  type CompanionCatalogRevisionId,
  companionCatalogRevisionIdSchema,
} from "@/features/catalog/catalog-revision-id";

export const revisionAnnotationsSchema = z
  .object({
    catalogRevisionId: companionCatalogRevisionIdSchema,
    document: annotationDocumentSchema,
  })
  .strict();

const missingRevisionAnnotationsSchema = z
  .object({
    catalogRevisionId: z.null(),
    document: z.null(),
  })
  .strict();

const revisionAnnotationsReadSchema = z.union([revisionAnnotationsSchema, missingRevisionAnnotationsSchema]);

export type RevisionAnnotations = Readonly<{
  catalogRevisionId: CompanionCatalogRevisionId;
  document: AnnotationDocument;
}>;

export type RevisionAnnotationsRead = RevisionAnnotations | Readonly<{ catalogRevisionId: null; document: null }>;

function parseWithMessage<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);

  if (!result.success) throw new Error(message, { cause: result.error });
  return result.data;
}

export function parseRevisionAnnotations(input: unknown): RevisionAnnotations {
  return parseWithMessage(revisionAnnotationsSchema, input, "Invalid revision annotations.");
}

export function parseRevisionAnnotationsRead(input: unknown): RevisionAnnotationsRead {
  return parseWithMessage(revisionAnnotationsReadSchema, input, "Invalid revision annotations response.");
}
