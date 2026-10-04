import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "overlay-kit";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { CompanionCatalog } from "@/features/catalog/catalog";
import { createApp } from "@/server/create-app";
import { createCatalogRevisionId } from "@/server/create-catalog-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { createReviewUpdates, type ReviewUpdates } from "@/server/review-updates";
import { writeCatalog } from "@/server/write-catalog";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

function catalog(nodeTitle: string): CompanionCatalog {
  return {
    behaviors: [
      {
        id: "checkout",
        updatedAt: "2026-10-03T09:15:00.000Z",
        title: "Checkout workflow",
        generator: "built-in:freeform",
        instructions:
          "## Purpose\nReview the checkout trigger.\n\n## Regeneration\nRebuild the trigger from the current checkout flow.",
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

const initialArtifact = catalog("Checkout submitted");
const revisedArtifact = catalog("Checkout started");

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

describe("reviewer continues a review after the catalog is revised", () => {
  it("continues with the revised diagram while comments from the previous revision are hidden", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-journey-"));
    let updates: ReviewUpdates | undefined;

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, ".architecture-companion/annotations"));
      await writeCatalog(scopePath, initialArtifact);
      await writeFile(
        join(scopePath, getAnnotationDocumentRelativePath(createCatalogRevisionId(initialArtifact))),
        JSON.stringify(initialComments),
      );
      const scope = await resolveCompanionScope(scopePath);
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
        await waitForDiagramReady();
        expect(
          await screen.findByRole("button", { name: "Comment: Please refine the trigger wording." }),
        ).toBeInTheDocument();

        await writeCatalog(scopePath, revisedArtifact);
        expect(await screen.findByText("Checkout started")).toBeInTheDocument();
        await waitForDiagramReady();
        expect(
          screen.queryByRole("button", { name: "Comment: Please refine the trigger wording." }),
        ).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Comment" }));
        const region = await screen.findByRole("region", { name: "Checkout workflow product behavior diagram" });
        fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }), {
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
