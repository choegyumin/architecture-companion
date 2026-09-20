import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "overlay-kit";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createApp } from "@/server/create-app";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { createReviewUpdates, type ReviewUpdates } from "@/server/review-updates";
import { writeArtifact } from "@/server/write-artifact";

function artifact(nodeTitle: string): Artifact {
  return {
    behaviors: [
      {
        id: "checkout",
        title: "Checkout workflow",
        generatorId: "freeform",
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title: nodeTitle }],
          edges: [],
        },
      },
    ],
    designs: [],
  };
}

const initialArtifact = artifact("Checkout submitted");
const revisedArtifact = artifact("Checkout started");

const initialComments: AnnotationDocument = {
  annotations: [
    {
      id: "annotation-initial",
      anchor: { canvasId: "behavior:checkout", point: { x: 120, y: 90 } },
      comment: {
        id: "comment-initial",
        author: { id: "reviewer-1", name: "Reviewer" },
        body: "Please refine the trigger wording.",
        createdAt: "2026-09-16T00:00:00.000Z",
      },
    },
  ],
};

describe("reviewer continues a review after the artifact is revised", () => {
  it("continues with the revised diagram while comments from the previous revision are hidden", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-journey-"));
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, ".architecture-companion/annotations"));
      await writeArtifact(scopePath, initialArtifact);
      await writeFile(
        join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(initialArtifact))),
        JSON.stringify(initialComments),
      );
      const scope = await resolveConsumerScope(scopePath);
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const app = createApp(scope, { reviewUpdates: updates });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );
      const review = render(
        <OverlayProvider>
          <WorkspacePage client={client} />
        </OverlayProvider>,
      );

      try {
        expect(await screen.findByText("Checkout submitted")).toBeInTheDocument();
        expect(
          await screen.findByRole("button", { name: "Comment: Please refine the trigger wording." }),
        ).toBeInTheDocument();

        await writeArtifact(scopePath, revisedArtifact);
        expect(await screen.findByText("Checkout started")).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Comment: Please refine the trigger wording." }),
        ).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Comment" }));
        const region = await screen.findByRole("region", { name: "Checkout workflow product behavior diagram" });
        fireEvent.click(within(region).getByRole("group", { name: "Diagram canvas" }), {
          clientX: 140,
          clientY: 100,
        });
        const composer = await screen.findByRole("form", { name: "Add comment" });
        await userEvent.type(within(composer).getByLabelText("Comment text"), "The revised trigger is clearer.");
        await userEvent.click(within(composer).getByRole("button", { name: "Post" }));

        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Comment: The revised trigger is clearer." })).toBeInTheDocument(),
        );
      } finally {
        review.unmount();
      }
    } finally {
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });
});
