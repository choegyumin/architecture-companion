import { z } from "zod";

export const annotationTargetSchema = z
  .object({
    type: z.enum(["group", "node", "edge"]),
    id: z.string().min(1),
  })
  .strict();
export type AnnotationTarget = Readonly<z.infer<typeof annotationTargetSchema>>;

export const annotationAnchorSchema = z
  .object({
    canvasId: z.string().min(1),
    target: annotationTargetSchema.optional(),
    point: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .strict(),
  })
  .strict();
export type AnnotationAnchor = Readonly<z.infer<typeof annotationAnchorSchema>>;

export const commentAuthorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type CommentAuthor = Readonly<z.infer<typeof commentAuthorSchema>>;

export const commentSchema = z
  .object({
    id: z.string().min(1),
    author: commentAuthorSchema,
    body: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Comment = Readonly<z.infer<typeof commentSchema>>;

export const annotationSchema = z
  .object({
    id: z.string().min(1),
    anchor: annotationAnchorSchema,
    comment: commentSchema,
  })
  .strict();
export type Annotation = Readonly<z.infer<typeof annotationSchema>>;

export const annotationDocumentSchema = z
  .object({
    annotations: z.array(annotationSchema),
  })
  .strict();
export type AnnotationDocument = Readonly<z.infer<typeof annotationDocumentSchema>>;

export function parseAnnotationDocument(input: unknown): AnnotationDocument {
  const result = annotationDocumentSchema.safeParse(input);

  if (!result.success) {
    const messages = result.error.issues.map(({ message }) => message).join("; ");
    throw new Error(`Invalid annotation document: ${messages}`, { cause: result.error });
  }

  return result.data;
}
