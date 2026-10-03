import { z } from "zod";

export const companionCatalogRevisionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Catalog revision ID must be a 64-character lowercase hexadecimal string.")
  .brand<"CompanionCatalogRevisionId">();

export type CompanionCatalogRevisionId = z.infer<typeof companionCatalogRevisionIdSchema>;

export function parseCatalogRevisionId(input: unknown): CompanionCatalogRevisionId {
  const result = companionCatalogRevisionIdSchema.safeParse(input);

  if (!result.success) {
    throw new Error("Invalid Catalog revision ID.", { cause: result.error });
  }

  return result.data;
}
