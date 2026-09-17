import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";

import { parseRevisionAnnotations, type RevisionAnnotations } from "@/features/annotation/revision-annotations";
import type { ArtifactRevisionId } from "@/features/artifact/artifact-revision-id";
import type { ConsumerScope } from "@/server/consumer-scope";
import { createAnnotationEtag } from "@/server/create-annotation-etag";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import {
  AnnotationDocumentConflictError,
  createFileAnnotationRepository,
  type RevisionAnnotationRepository,
} from "@/server/file-annotation-repository";
import { isLocalAppActionRequestAllowed } from "@/server/local-app-action-request";
import { type OpenPath, openSourceReference } from "@/server/open-source-reference";
import { readActiveRevisionAnnotations } from "@/server/read-active-revision-annotations";
import { readArtifact } from "@/server/read-artifact";
import type { ReviewUpdates } from "@/server/review-updates";
import { isSourceOpenRequestAllowed } from "@/server/source-open-request";
import { openLocalPath } from "@/shared/node/open-local-path";

type CreateAppDependencies = Readonly<{
  openPath?: OpenPath;
  reviewUpdates?: Pick<ReviewUpdates, "subscribe">;
  annotationRepository?: RevisionAnnotationRepository;
}>;

const defaultOpenPath: OpenPath = async ({ path, line }) => {
  if (line !== undefined) {
    throw new Error("Line-specific source opening requires an editor adapter.");
  }
  await openLocalPath(path);
};

type ReadArtifactRevisionResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "invalid"; message: string }>
  | Readonly<{ status: "valid"; artifactRevisionId: ArtifactRevisionId }>;

class ArtifactRevisionConflictError extends Error {}
class InvalidArtifactForAnnotationsError extends Error {}

async function readArtifactRevision(scopePath: string): Promise<ReadArtifactRevisionResult> {
  const result = await readArtifact(scopePath);
  if (result.status !== "valid") return result;
  return { status: "valid", artifactRevisionId: createArtifactRevisionId(result.artifact) };
}

async function validateArtifactRevision(scopePath: string, expectedRevisionId: ArtifactRevisionId): Promise<void> {
  const result = await readArtifactRevision(scopePath);
  if (result.status === "invalid") throw new InvalidArtifactForAnnotationsError(result.message);
  if (result.status === "missing" || result.artifactRevisionId !== expectedRevisionId) {
    throw new ArtifactRevisionConflictError();
  }
}

export function createApp(scope: ConsumerScope, dependencies: CreateAppDependencies = {}) {
  const openPath = dependencies.openPath ?? defaultOpenPath;
  const reviewUpdates = dependencies.reviewUpdates;
  const annotationRepository = dependencies.annotationRepository ?? createFileAnnotationRepository(scope.path);

  return new Hono()
    .get("/api/review", async (context) => {
      const result = await readArtifact(scope.path);

      if (result.status === "invalid") {
        return context.json(
          {
            scope,
            artifact: null,
            error: { message: result.message },
          },
          422,
        );
      }

      if (result.status === "valid") {
        return context.json({
          scope,
          artifact: result.artifact,
          artifactRevisionId: createArtifactRevisionId(result.artifact),
        });
      }

      return context.json({ scope, artifact: null });
    })
    .get("/api/review/events", (context) =>
      streamSSE(context, async (stream) => {
        let pendingWrite = Promise.resolve();

        const publish = (data: unknown): void => {
          pendingWrite = pendingWrite.then(async () => {
            await stream.writeSSE({ event: "review", data: JSON.stringify(data) });
          });
        };

        await new Promise<void>((resolve) => {
          const unsubscribe = reviewUpdates?.subscribe(publish) ?? (() => undefined);

          stream.onAbort(() => {
            unsubscribe();
            resolve();
          });
          publish({ revision: 0 });
        });
        await pendingWrite;
      }),
    )
    .get("/api/annotations", async (context) => {
      const result = await readActiveRevisionAnnotations(scope.path, annotationRepository);
      if (result.status === "invalid") {
        return context.json({ error: { message: result.message } }, 422);
      }

      const revisionAnnotations = result.revisionAnnotations;
      if (revisionAnnotations.artifactRevisionId === null) return context.json(revisionAnnotations);

      context.header("ETag", createAnnotationEtag(revisionAnnotations));
      return context.json(revisionAnnotations);
    })
    .put(
      "/api/annotations",
      async (context, next) => {
        const allowed = isLocalAppActionRequestAllowed({
          action: context.req.raw.headers.get("x-architecture-companion-action"),
          expectedAction: "save-annotations",
          origin: context.req.raw.headers.get("origin"),
          requestOrigin: new URL(context.req.url).origin,
          fetchSite: context.req.raw.headers.get("sec-fetch-site"),
        });

        if (!allowed) {
          return context.json(
            { error: { message: "Annotations can only be saved from the local Architecture Companion page." } },
            403,
          );
        }

        await next();
      },
      validator("json", (input, context) => {
        try {
          return parseRevisionAnnotations(input);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Revision annotations are invalid.";
          return context.json({ error: { message } }, 422);
        }
      }),
      async (context) => {
        const revisionAnnotations = context.req.valid("json");
        const expectedEtag = context.req.header("If-Match");
        if (!expectedEtag) {
          return context.json({ error: { message: "Annotation revision is required. Reload before saving." } }, 428);
        }

        try {
          const artifactResult = await readArtifactRevision(scope.path);
          if (artifactResult.status === "invalid") {
            return context.json({ error: { message: artifactResult.message } }, 422);
          }
          if (
            artifactResult.status === "missing" ||
            artifactResult.artifactRevisionId !== revisionAnnotations.artifactRevisionId
          ) {
            return context.json(
              { error: { message: "Artifact changed or is unavailable. Reload before saving annotations." } },
              409,
            );
          }

          const currentRevisionAnnotations: RevisionAnnotations = {
            artifactRevisionId: revisionAnnotations.artifactRevisionId,
            document: await annotationRepository.load(revisionAnnotations.artifactRevisionId),
          };
          if (expectedEtag !== createAnnotationEtag(currentRevisionAnnotations)) {
            return context.json(
              { error: { message: "Annotations changed outside the app. Reload before saving." } },
              412,
            );
          }

          await annotationRepository.save({
            ...revisionAnnotations,
            expectedDocument: currentRevisionAnnotations.document,
            validateBeforeCommit: () => validateArtifactRevision(scope.path, revisionAnnotations.artifactRevisionId),
          });
          context.header("ETag", createAnnotationEtag(revisionAnnotations));
          return context.json(revisionAnnotations);
        } catch (error) {
          if (error instanceof AnnotationDocumentConflictError) {
            return context.json(
              { error: { message: "Annotations changed outside the app. Reload before saving." } },
              412,
            );
          }
          if (error instanceof InvalidArtifactForAnnotationsError) {
            return context.json({ error: { message: error.message } }, 422);
          }
          if (error instanceof ArtifactRevisionConflictError) {
            return context.json(
              { error: { message: "Artifact changed or is unavailable. Reload before saving annotations." } },
              409,
            );
          }
          return context.json({ error: { message: "Annotation document could not be saved." } }, 500);
        }
      },
    )
    .post(
      "/api/source/open",
      async (context, next) => {
        const action = context.req.raw.headers.get("x-architecture-companion-action");
        const origin = context.req.raw.headers.get("origin");
        const requestOrigin = new URL(context.req.url).origin;
        const fetchSite = context.req.raw.headers.get("sec-fetch-site");

        if (!isSourceOpenRequestAllowed({ action, origin, requestOrigin, fetchSite })) {
          return context.json(
            { error: { message: "Source files can only be opened from the local Architecture Companion page." } },
            403,
          );
        }

        await next();
      },
      validator("json", (input, context) => {
        if (typeof input !== "object" || input === null || !("href" in input) || typeof input.href !== "string") {
          return context.json({ error: { message: "Source open request must contain an href." } }, 422);
        }
        return { href: input.href };
      }),
      async (context) => {
        const { href } = context.req.valid("json");
        const result = await openSourceReference(scope, href, openPath);
        if (result.status !== 200) return context.json({ error: { message: result.message } }, result.status);

        return context.json({ opened: { href: result.href } });
      },
    );
}

export type AppType = ReturnType<typeof createApp>;
