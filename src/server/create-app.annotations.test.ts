import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createApp } from "@/server/create-app";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import {
  createFileAnnotationRepository,
  getAnnotationDocumentRelativePath,
  type RevisionAnnotationRepository,
} from "@/server/file-annotation-repository";
import { ARTIFACT_RELATIVE_PATH } from "@/server/read-artifact";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

const baseUrl = "http://architecture-companion.test";
const emptyDocument: AnnotationDocument = { annotations: [] };

function artifact(title: string): Artifact {
  return {
    processes: [
      {
        id: "checkout",
        title,
        generatorId: "freeform",
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ id: "submit", type: "default", kind: "trigger", title: "Checkout submitted" }],
          edges: [],
        },
      },
    ],
    designs: [],
  };
}

const firstArtifact = artifact("Checkout workflow");
const secondArtifact = artifact("Changed checkout workflow");
const firstRevisionId = createArtifactRevisionId(firstArtifact);

function document(body: string): AnnotationDocument {
  return {
    annotations: [
      {
        id: `annotation-${body}`,
        anchor: { canvasId: "process:checkout", point: { x: 120, y: 80 } },
        comment: {
          id: `comment-${body}`,
          author: { id: "local-reviewer", name: "Local reviewer" },
          body,
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      },
    ],
  };
}

async function writeArtifact(scopePath: string, input: unknown): Promise<void> {
  await mkdir(join(scopePath, ".architecture-companion"), { recursive: true });
  await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(input));
}

async function putAnnotations(
  app: ReturnType<typeof createApp>,
  body: unknown,
  etag?: string | null,
): Promise<Response> {
  return app.request(`${baseUrl}/api/annotations`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(etag === undefined ? {} : { "If-Match": etag ?? "" }),
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-Architecture-Companion-Action": "save-annotations",
    },
  });
}

async function createRejectionReview(): Promise<
  Readonly<{
    app: ReturnType<typeof createApp>;
    counts: Readonly<{ load: () => number; save: () => number }>;
    scopePath: string;
  }>
> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));
  await writeArtifact(scopePath, firstArtifact);
  let loadCount = 0;
  let saveCount = 0;
  const repository: RevisionAnnotationRepository = {
    load: async () => {
      loadCount += 1;
      return emptyDocument;
    },
    save: async () => {
      saveCount += 1;
    },
  };
  const app = createApp(await resolveConsumerScope(scopePath), { annotationRepository: repository });

  return {
    app,
    counts: { load: () => loadCount, save: () => saveCount },
    scopePath,
  };
}

describe("annotation server", () => {
  test("returns a read-only empty state and rejects saves when the Artifact is missing", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      const app = createApp(await resolveConsumerScope(scopePath));
      const response = await app.request(`${baseUrl}/api/annotations`);

      expect(response.status).toBe(200);
      expect(response.headers.get("ETag")).toBeNull();
      await expect(response.json()).resolves.toEqual({ artifactRevisionId: null, document: null });
      expect(
        (await putAnnotations(app, { artifactRevisionId: firstRevisionId, document: emptyDocument }, '"etag"')).status,
      ).toBe(409);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("neither reads nor saves Annotations when the Artifact is invalid", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, { processes: "invalid", designs: [] });
      const app = createApp(await resolveConsumerScope(scopePath));

      expect((await app.request(`${baseUrl}/api/annotations`)).status).toBe(422);
      expect(
        (await putAnnotations(app, { artifactRevisionId: firstRevisionId, document: emptyDocument }, '"etag"')).status,
      ).toBe(422);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("saves an Annotation for the current Artifact revision and restores it in a new app", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, firstArtifact);
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope);
      const current = await app.request(`${baseUrl}/api/annotations`);
      const savedDocument = document("Move this responsibility.");

      expect(await current.clone().json()).toEqual({
        artifactRevisionId: firstRevisionId,
        document: emptyDocument,
      });
      const saved = await putAnnotations(
        app,
        { artifactRevisionId: firstRevisionId, document: savedDocument },
        current.headers.get("ETag"),
      );

      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ artifactRevisionId: firstRevisionId, document: savedDocument });
      expect(
        JSON.parse(await readFile(join(scopePath, getAnnotationDocumentRelativePath(firstRevisionId)), "utf8")),
      ).toEqual(savedDocument);
      await expect(readFile(join(scopePath, ".architecture-companion/.gitignore"), "utf8")).resolves.toBe(
        "/annotations/\n",
      );

      const restored = await createApp(scope).request(`${baseUrl}/api/annotations`);
      await expect(restored.json()).resolves.toEqual({
        artifactRevisionId: firstRevisionId,
        document: savedDocument,
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("isolates ETags and Annotations per revision and restores them when the same Artifact returns", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, firstArtifact);
      const app = createApp(await resolveConsumerScope(scopePath));
      const first = await app.request(`${baseUrl}/api/annotations`);
      const savedDocument = document("First revision");
      expect(
        (
          await putAnnotations(
            app,
            { artifactRevisionId: firstRevisionId, document: savedDocument },
            first.headers.get("ETag"),
          )
        ).status,
      ).toBe(200);

      await writeArtifact(scopePath, secondArtifact);
      const second = await app.request(`${baseUrl}/api/annotations`);
      expect(second.headers.get("ETag")).not.toBe(first.headers.get("ETag"));
      await expect(second.json()).resolves.toEqual({
        artifactRevisionId: createArtifactRevisionId(secondArtifact),
        document: emptyDocument,
      });

      await writeArtifact(scopePath, firstArtifact);
      await expect((await app.request(`${baseUrl}/api/annotations`)).json()).resolves.toEqual({
        artifactRevisionId: firstRevisionId,
        document: savedDocument,
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects an unauthorized PUT before writing", async () => {
    const { app, counts, scopePath } = await createRejectionReview();

    try {
      const response = await app.request(`${baseUrl}/api/annotations`, {
        method: "PUT",
        body: "{invalid",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(403);
      expect(counts.load()).toBe(0);
      expect(counts.save()).toBe(0);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects a path-unsafe revision ID save before writing", async () => {
    const { app, counts, scopePath } = await createRejectionReview();

    try {
      expect(
        (await putAnnotations(app, { artifactRevisionId: "../outside", document: emptyDocument }, '"etag"')).status,
      ).toBe(422);
      expect(counts.load()).toBe(0);
      expect(counts.save()).toBe(0);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects an invalid save envelope before writing", async () => {
    const { app, counts, scopePath } = await createRejectionReview();

    try {
      expect((await putAnnotations(app, emptyDocument, '"etag"')).status).toBe(422);
      expect(counts.load()).toBe(0);
      expect(counts.save()).toBe(0);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects a save without If-Match before writing", async () => {
    const { app, counts, scopePath } = await createRejectionReview();

    try {
      expect((await putAnnotations(app, { artifactRevisionId: firstRevisionId, document: emptyDocument })).status).toBe(
        428,
      );
      expect(counts.load()).toBe(0);
      expect(counts.save()).toBe(0);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects a save for an earlier revision after the Artifact revision changed", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, firstArtifact);
      const app = createApp(await resolveConsumerScope(scopePath));
      const current = await app.request(`${baseUrl}/api/annotations`);
      await writeArtifact(scopePath, secondArtifact);

      const response = await putAnnotations(
        app,
        { artifactRevisionId: firstRevisionId, document: document("Stale artifact") },
        current.headers.get("ETag"),
      );

      expect(response.status).toBe(409);
      await expect(
        readFile(join(scopePath, getAnnotationDocumentRelativePath(firstRevisionId)), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects a stale Annotation save within the same revision with 412", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, firstArtifact);
      const app = createApp(await resolveConsumerScope(scopePath));
      const current = await app.request(`${baseUrl}/api/annotations`);
      const etag = current.headers.get("ETag");

      expect(
        (await putAnnotations(app, { artifactRevisionId: firstRevisionId, document: document("First") }, etag)).status,
      ).toBe(200);
      const stale = await putAnnotations(
        app,
        { artifactRevisionId: firstRevisionId, document: document("Stale") },
        etag,
      );

      expect(stale.status).toBe(412);
      await expect(stale.json()).resolves.toEqual({
        error: { message: "Annotations changed outside the app. Reload before saving." },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("applies only one of two concurrent saves with the same precondition", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));

    try {
      await writeArtifact(scopePath, firstArtifact);
      const app = createApp(await resolveConsumerScope(scopePath));
      const current = await app.request(`${baseUrl}/api/annotations`);
      const etag = current.headers.get("ETag");
      const documents = [document("First"), document("Second")];
      const responses = await Promise.all(
        documents.map((nextDocument) =>
          putAnnotations(app, { artifactRevisionId: firstRevisionId, document: nextDocument }, etag),
        ),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 412]);
      const persisted = await createFileAnnotationRepository(scopePath).load(firstRevisionId);
      expect(documents).toContainEqual(persisted);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("does not replace the file when the Artifact revision changes just before saving", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comments-"));
    let committed = false;
    const repository: RevisionAnnotationRepository = {
      load: async () => emptyDocument,
      save: async ({ validateBeforeCommit }) => {
        await writeArtifact(scopePath, secondArtifact);
        await validateBeforeCommit?.();
        committed = true;
      },
    };

    try {
      await writeArtifact(scopePath, firstArtifact);
      const app = createApp(await resolveConsumerScope(scopePath), { annotationRepository: repository });
      const current = await app.request(`${baseUrl}/api/annotations`);
      const response = await putAnnotations(
        app,
        { artifactRevisionId: firstRevisionId, document: document("Stale") },
        current.headers.get("ETag"),
      );

      expect(response.status).toBe(409);
      expect(committed).toBe(false);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
