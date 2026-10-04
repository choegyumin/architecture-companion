import { createHash } from "node:crypto";

import { type CompanionCatalog, parseCatalog } from "@/features/catalog/catalog";
import { type CompanionCatalogRevisionId, parseCatalogRevisionId } from "@/features/catalog/catalog-revision-id";

export function createCatalogRevisionId(catalog: CompanionCatalog): CompanionCatalogRevisionId {
  const canonicalCatalog = parseCatalog(catalog);
  const digest = createHash("sha256").update(JSON.stringify(canonicalCatalog)).digest("hex");
  return parseCatalogRevisionId(digest);
}
