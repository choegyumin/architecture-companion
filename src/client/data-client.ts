import { hc } from "hono/client";

import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import {
  parseRevisionAnnotations,
  parseRevisionAnnotationsRead,
  type RevisionAnnotationsRead,
} from "@/features/annotation/revision-annotations";
import type { ArtifactRevisionId } from "@/features/artifact/artifact-revision-id";
import type { Diagram } from "@/features/diagram/diagram";
// oxlint-disable-next-line boundaries/dependencies -- Hono hc requires the server AppType as a type-only RPC contract.
import type { AppType } from "@/server/create-app";

function getErrorMessage(result: unknown, fallback: string): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  ) {
    return result.error.message;
  }

  return fallback;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return getErrorMessage(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

type AnnotationRevision = Readonly<{
  artifactRevisionId: ArtifactRevisionId;
  etag: string;
}>;

function sortDiagramsByTitle(diagrams: readonly Diagram[]): readonly Diagram[] {
  return diagrams.toSorted((left, right) => left.title.localeCompare(right.title));
}

export function createDataClient(baseUrl: string, fetcher: typeof fetch = globalThis.fetch) {
  const rpc = hc<AppType>(baseUrl, { fetch: fetcher });
  const annotationRevisions = new WeakMap<AnnotationDocument, AnnotationRevision>();

  function readAnnotationEtag(response: Response): string {
    const etag = response.headers.get("ETag");
    if (!etag) throw new Error("Annotation response is missing its revision.");
    return etag;
  }

  async function getAnnotations(): Promise<RevisionAnnotationsRead> {
    const response = await rpc.api.annotations.$get();

    if (response.status === 422) return { artifactRevisionId: null, document: null };
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, `Annotation request failed with status ${response.status}.`));
    }

    const revisionAnnotations = parseRevisionAnnotationsRead(await response.json());
    if (revisionAnnotations.document === null) return revisionAnnotations;

    annotationRevisions.set(revisionAnnotations.document, {
      artifactRevisionId: revisionAnnotations.artifactRevisionId,
      etag: readAnnotationEtag(response),
    });
    return revisionAnnotations;
  }

  async function saveAnnotations(
    document: AnnotationDocument,
    expectedDocument?: AnnotationDocument,
  ): Promise<AnnotationDocument> {
    const current = expectedDocument ? undefined : await getAnnotations();
    const baseDocument = expectedDocument ?? current?.document;
    if (!baseDocument) throw new Error("Annotation revision is unavailable. Reload before saving.");

    const revision = annotationRevisions.get(baseDocument);
    if (!revision) throw new Error("Annotation revision is unavailable. Reload before saving.");

    const response = await rpc.api.annotations.$put(
      { json: { artifactRevisionId: revision.artifactRevisionId, document } },
      {
        headers: {
          "If-Match": revision.etag,
          "X-Architecture-Companion-Action": "save-annotations",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, `Annotation save request failed with status ${response.status}.`),
      );
    }

    const saved = parseRevisionAnnotations(await response.json());
    annotationRevisions.set(saved.document, {
      artifactRevisionId: saved.artifactRevisionId,
      etag: readAnnotationEtag(response),
    });
    return saved.document;
  }

  async function consumeReviewEvents(
    signal: AbortSignal,
    onUpdate: () => void,
    onError?: (error: Error) => void,
  ): Promise<void> {
    try {
      const response = await fetcher(`${baseUrl}/api/review/events`, {
        headers: { Accept: "text/event-stream" },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Review event request failed with status ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const result = await reader.read();
        buffer += decoder.decode(result.value, { stream: !result.done }).replaceAll("\r\n", "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (event.split("\n").some((line) => line === "event: review")) onUpdate();
          boundary = buffer.indexOf("\n\n");
        }

        if (result.done) break;
      }
    } catch (error) {
      if (signal.aborted) return;
      onError?.(error instanceof Error ? error : new Error("Review event stream failed."));
    }
  }

  return {
    getAnnotations,
    saveAnnotations,
    getReview: async () => {
      const response = await rpc.api.review.$get();

      if (!response.ok && response.status !== 422) {
        throw new Error(`Review request failed with status ${response.status}.`);
      }

      const review = await response.json();
      if (!review.artifact) return review;

      return {
        ...review,
        artifact: {
          ...review.artifact,
          designs: sortDiagramsByTitle(review.artifact.designs),
          processes: sortDiagramsByTitle(review.artifact.processes),
        },
      };
    },
    openSource: async (href: string) => {
      const response = await rpc.api.source.open.$post(
        { json: { href } },
        { headers: { "X-Architecture-Companion-Action": "open-source" } },
      );
      const result: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getErrorMessage(result, `Source open request failed with status ${response.status}.`));
      }

      return result;
    },
    subscribeToReviewUpdates: (onUpdate: () => void, onError?: (error: Error) => void) => {
      const controller = new AbortController();
      void consumeReviewEvents(controller.signal, onUpdate, onError);

      return () => controller.abort();
    },
  };
}

export type DataClient = ReturnType<typeof createDataClient>;
