import { type CompanionCatalog, parseCatalog } from "@/features/catalog/catalog";

export function validateCatalog(input: unknown): CompanionCatalog {
  return parseCatalog(input);
}
