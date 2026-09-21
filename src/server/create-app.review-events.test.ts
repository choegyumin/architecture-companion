import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDataClient } from "@/client/data-client";
import type { Artifact } from "@/features/artifact/artifact";
import type { ConsumerScope } from "@/server/consumer-scope";
import { createApp } from "@/server/create-app";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { createReviewUpdates, type ReviewUpdates } from "@/server/review-updates";
import { writeArtifact } from "@/server/write-artifact";

function artifact(title: string): Artifact {
  return {
    behaviors: [
      {
        title: "Workflow",
        generator: "freeform",
        layout: { id: "elk-layered", options: { direction: "RIGHT" } },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title }],
          edges: [],
        },
        id: "checkout",
      },
    ],
    designs: [],
  };
}

async function writeAnnotations(scopePath: string, activeArtifact: Artifact, body: string): Promise<void> {
  await mkdir(join(scopePath, ".architecture-companion/annotations"), { recursive: true });
  await writeFile(
    join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(activeArtifact))),
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
    const initialArtifact = artifact("Checkout requested");
    const changedArtifact = artifact("Checkout started");
    let updates: ReviewUpdates | undefined;
    let unsubscribe: () => void = () => undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, initialArtifact);
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const scope: ConsumerScope = { isGitRepository: false, path: scopePath };
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

      await writeArtifact(scopePath, changedArtifact);
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
