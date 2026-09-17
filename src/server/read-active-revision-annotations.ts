import type { RevisionAnnotationsRead } from "@/features/annotation/revision-annotations";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import type { RevisionAnnotationRepository } from "@/server/file-annotation-repository";
import { readArtifact } from "@/server/read-artifact";

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
  const artifactResult = await readArtifact(scopePath);
  if (artifactResult.status === "invalid") return artifactResult;
  if (artifactResult.status === "missing") {
    return {
      status: "valid",
      revisionAnnotations: { artifactRevisionId: null, document: null },
    };
  }

  const artifactRevisionId = createArtifactRevisionId(artifactResult.artifact);

  try {
    return {
      status: "valid",
      revisionAnnotations: {
        artifactRevisionId,
        document: await annotationRepository.load(artifactRevisionId),
      },
    };
  } catch (error) {
    throw new Error(`Could not read active Annotation document. ${errorMessage(error)}`, { cause: error });
  }
}
