import { createHash } from "node:crypto";

import { type CompanionCatalog, parseCatalog } from "@/features/catalog/catalog";
import { type CompanionCatalogRevisionId, parseCatalogRevisionId } from "@/features/catalog/catalog-revision-id";

/** Hash the unchanged, normalized output of readCatalog or parseCatalog. */
export function hashNormalizedCatalog(catalog: CompanionCatalog): CompanionCatalogRevisionId {
  const digest = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
  return parseCatalogRevisionId(digest);
}

export function createCatalogRevisionId(catalog: CompanionCatalog): CompanionCatalogRevisionId {
  return hashNormalizedCatalog(parseCatalog(catalog));
}
