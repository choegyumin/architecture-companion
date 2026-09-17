import { z } from "zod";

export const artifactRevisionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Artifact revision ID must be a 64-character lowercase hexadecimal string.")
  .brand<"ArtifactRevisionId">();

export type ArtifactRevisionId = z.infer<typeof artifactRevisionIdSchema>;

export function parseArtifactRevisionId(input: unknown): ArtifactRevisionId {
  const result = artifactRevisionIdSchema.safeParse(input);

  if (!result.success) {
    throw new Error("Invalid Artifact revision ID.", { cause: result.error });
  }

  return result.data;
}
