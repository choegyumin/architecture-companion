import type { RevisionAnnotationsRead } from "@/features/annotation/revision-annotations";
import { createCatalogRevisionId } from "@/server/create-catalog-revision-id";
import type { RevisionAnnotationRepository } from "@/server/file-annotation-repository";
import { readCatalog } from "@/server/read-catalog";

export type ReadActiveRevisionAnnotationsResult =
  | Readonly<{ status: "invalid"; message: string }>
  | Readonly<{ status: "valid"; revisionAnnotations: RevisionAnnotationsRead }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function readActiveRevisionAnnotations(
  scopePath: string,
  annotationRepository: RevisionAnnotationRepository,
): Promise<ReadActiveRevisionAnnotationsResult> {
  const catalogResult = await readCatalog(scopePath);
  if (catalogResult.status === "invalid") return catalogResult;
  if (catalogResult.status === "missing") {
    return {
      status: "valid",
      revisionAnnotations: { catalogRevisionId: null, document: null },
    };
  }

  const catalogRevisionId = createCatalogRevisionId(catalogResult.catalog);

  try {
    return {
      status: "valid",
      revisionAnnotations: {
        catalogRevisionId,
        document: await annotationRepository.load(catalogRevisionId),
      },
    };
  } catch (error) {
    throw new Error(`Could not read active Annotation document. ${errorMessage(error)}`, { cause: error });
  }
}
