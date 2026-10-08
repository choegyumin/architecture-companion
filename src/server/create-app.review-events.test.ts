import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDataClient } from "@/client/data-client";
import type { CompanionCatalog } from "@/features/catalog/catalog";
import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createCatalogRevisionId } from "@/server/create-catalog-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { createReviewUpdates, type ReviewUpdates } from "@/server/review-updates";
import { writeCatalog } from "@/server/write-catalog";

function catalog(title: string): CompanionCatalog {
  return {
    behaviors: [
      {
        title: "Workflow",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions:
          "## Purpose\nReview the checkout trigger.\n\n## Regeneration\nRebuild the trigger from the current checkout flow.",
        diagram: {
          layout: { id: "elk-layered", options: { elk: { direction: "RIGHT" } } },
          graph: {
            groups: [],
            nodes: [{ type: "default", id: "submit", kind: "trigger", title }],
            edges: [],
          },
        },
        id: "checkout",
      },
    ],
    designs: [],
  };
}

async function writeAnnotations(scopePath: string, activeArtifact: CompanionCatalog, body: string): Promise<void> {
  await mkdir(join(scopePath, ".architecture-companion/annotations"), { recursive: true });
  await writeFile(
    join(scopePath, getAnnotationDocumentRelativePath(createCatalogRevisionId(activeArtifact))),
    JSON.stringify({
      annotations: [
        {
          id: "review-note",
          anchor: { canvasId: "behavior:checkout", point: { x: 120, y: 80 } },
          comment: {
            id: "review-comment",
            author: { id: "reviewer", name: "Reviewer" },
            body,
            createdAt: "2026-09-14T00:00:00.000Z",
          },
        },
      ],
    }),
  );
}

describe("review events", () => {
  it("delivers only external changes for the current revision over the Hono event stream", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-events-"));
    const initialArtifact = catalog("Checkout requested");
    const changedArtifact = catalog("Checkout started");
    let updates: ReviewUpdates | undefined;
    let unsubscribe: () => void = () => undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeCatalog(scopePath, initialArtifact);
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const scope: CompanionScope = { isGitRepository: false, path: scopePath };
      const app = createApp(scope, { reviewUpdates: updates });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );
      let eventsSeen = 0;

      unsubscribe = client.subscribeToReviewUpdates(() => {
        eventsSeen += 1;
      });

      await vi.waitFor(() => expect(eventsSeen).toBe(1));

      await writeAnnotations(scopePath, initialArtifact, "Review the request");
      await vi.waitFor(() => expect(eventsSeen).toBe(2));

      await writeCatalog(scopePath, changedArtifact);
      await vi.waitFor(() => expect(eventsSeen).toBe(3));

      await writeAnnotations(scopePath, changedArtifact, "Review the started checkout");
      await vi.waitFor(() => expect(eventsSeen).toBe(4));
    } finally {
      unsubscribe();
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });
});
