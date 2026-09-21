import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { BEHAVIORS_RELATIVE_PATH, readArtifact } from "@/server/read-artifact";
import { createReviewUpdates, type ReviewUpdate, type ReviewUpdates } from "@/server/review-updates";
import { writeArtifact } from "@/server/write-artifact";

function behavior(title: string): Artifact["behaviors"][number] {
  return {
    id: "checkout",
    title: "Workflow",
    generator: "freeform",
    layout: { id: "elk-layered", options: { direction: "RIGHT" } },
    graph: {
      groups: [],
      nodes: [{ id: "submit", type: "default", kind: "trigger", title }],
      edges: [],
    },
  };
}

function artifact(title: string): Artifact {
  return { behaviors: [behavior(title)], designs: [] };
}

async function writeAnnotations(
  scopePath: string,
  activeArtifact: Artifact,
  document: AnnotationDocument,
): Promise<void> {
  const annotationsPath = join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(activeArtifact)));
  await mkdir(dirname(annotationsPath), { recursive: true });
  await writeFile(annotationsPath, JSON.stringify(document));
}

function annotations(body: string): AnnotationDocument {
  return {
    annotations: [
      {
        id: "review-note",
        anchor: {
          canvasId: "behavior:checkout",
          point: { x: 120, y: 80 },
        },
        comment: {
          id: "review-comment",
          author: { id: "reviewer", name: "Reviewer" },
          body,
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      },
    ],
  };
}

describe("review updates", () => {
  test("publishes only Annotation changes for the current Artifact revision", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-updates-"));
    const activeArtifact = artifact("Checkout requested");
    const inactiveArtifact = artifact("Checkout completed");
    let updatesSeen: readonly ReviewUpdate[] = [];
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, activeArtifact);
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      updates.subscribe((update) => {
        updatesSeen = [...updatesSeen, update];
      });

      await writeAnnotations(scopePath, inactiveArtifact, annotations("Inactive revision"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updatesSeen).toEqual([]);

      await writeAnnotations(scopePath, activeArtifact, annotations("Active revision"));
      await vi.waitFor(() => expect(updatesSeen).toEqual([{ revision: 1, status: "valid" }]));

      await writeArtifact(scopePath, inactiveArtifact);
      await vi.waitFor(() =>
        expect(updatesSeen).toEqual([
          { revision: 1, status: "valid" },
          { revision: 2, status: "valid" },
        ]),
      );

      await writeAnnotations(scopePath, activeArtifact, annotations("Retained revision"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updatesSeen).toHaveLength(2);

      await writeArtifact(scopePath, activeArtifact);
      await vi.waitFor(() => expect(updatesSeen.at(-1)).toEqual({ revision: 3, status: "valid" }));
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });
  test("neither reads nor publishes changes outside the scope through a symlinked Annotation path", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-updates-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "architecture-companion-outside-"));
    const activeArtifact = artifact("Checkout requested");
    const artifactRevisionId = createArtifactRevisionId(activeArtifact);
    let updatesSeen: readonly ReviewUpdate[] = [];
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, activeArtifact);
      await writeFile(join(outsidePath, `${artifactRevisionId}.json`), JSON.stringify(annotations("Outside")));
      await symlink(outsidePath, join(scopePath, ".architecture-companion/annotations"), "dir");
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      updates.subscribe((update) => {
        updatesSeen = [...updatesSeen, update];
      });

      await writeFile(join(outsidePath, `${artifactRevisionId}.json`), JSON.stringify(annotations("Changed outside")));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updatesSeen).toEqual([]);
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
      await rm(outsidePath, { recursive: true });
    }
  });

  test("keeps polling and closes even when the Annotation revision path is unreadable", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-updates-"));
    const activeArtifact = artifact("Checkout requested");
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, activeArtifact);
      await mkdir(join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(activeArtifact))), {
        recursive: true,
      });

      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(updates.close()).resolves.toBeUndefined();
      updates = undefined;
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });

  it("publishes one valid update for a changed artifact and ignores an identical rewrite", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-updates-"));
    let updatesSeen: readonly ReviewUpdate[] = [];
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, artifact("Checkout requested"));
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const unsubscribe = updates.subscribe((update) => {
        updatesSeen = [...updatesSeen, update];
      });

      await writeArtifact(scopePath, artifact("Checkout started"));
      await vi.waitFor(() => expect(updatesSeen).toEqual([{ revision: 1, status: "valid" }]));

      await writeArtifact(scopePath, artifact("Checkout started"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updatesSeen).toEqual([{ revision: 1, status: "valid" }]);

      unsubscribe();
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });

  it("publishes partial and invalid writes before a valid recovery", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-updates-"));
    let updatesSeen: readonly ReviewUpdate[] = [];
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, artifact("Checkout requested"));
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      updates.subscribe((update) => {
        updatesSeen = [...updatesSeen, update];
      });

      await writeFile(join(scopePath, BEHAVIORS_RELATIVE_PATH, "checkout.json"), "{ partial");
      await vi.waitFor(() => expect(updatesSeen).toEqual([{ revision: 1, status: "invalid" }]));
      expect(await readArtifact(scopePath)).toEqual({
        status: "invalid",
        message: "Artifact contains invalid JSON: .architecture-companion/behaviors/checkout.json",
      });

      await writeAnnotations(scopePath, artifact("Checkout requested"), annotations("Ignored while invalid"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(updatesSeen).toHaveLength(1);

      await writeArtifact(scopePath, { behaviors: [{ ...behavior("Unsupported"), unexpected: true }], designs: [] });
      await vi.waitFor(() => expect(updatesSeen.at(-1)).toEqual({ revision: 2, status: "invalid" }));
      expect(await readArtifact(scopePath)).toMatchObject({
        status: "invalid",
        message: expect.stringContaining("Artifact is invalid: .architecture-companion/behaviors/checkout.json"),
      });

      await writeArtifact(scopePath, artifact("Checkout recovered"));
      await vi.waitFor(() => expect(updatesSeen.at(-1)).toEqual({ revision: 3, status: "valid" }));
      expect(await readArtifact(scopePath)).toMatchObject({
        status: "valid",
        artifact: { behaviors: [{ graph: { nodes: [{ title: "Checkout recovered" }] } }] },
      });
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });
});
