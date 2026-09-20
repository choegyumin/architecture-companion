import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createApp } from "@/server/create-app";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { createReviewUpdates } from "@/server/review-updates";
import { writeArtifact } from "@/server/write-artifact";

const artifact = {
  behaviors: [
    {
      id: "checkout",
      title: "Checkout workflow",
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
} satisfies Artifact;

function annotations(body: string): AnnotationDocument {
  return {
    annotations: [
      {
        id: "external-annotation",
        anchor: {
          canvasId: "behavior:checkout",
          point: { x: 120, y: 90 },
        },
        comment: {
          id: "external-comment",
          author: { id: "external-reviewer", name: "External reviewer" },
          body,
          createdAt: "2026-08-29T12:00:00.000Z",
        },
      },
    ],
  };
}

describe("reviewer keeps their own input after an external comment change", () => {
  it("keeps the local draft over an external change while editing a comment and saves it", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comment-conflict-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeArtifact(scopePath, artifact);
      await mkdir(join(scopePath, ".architecture-companion/annotations"));
      await writeFile(
        join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(artifact))),
        JSON.stringify(annotations("Original feedback")),
      );
      const scope = await resolveConsumerScope(scopePath);
      const updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const app = createApp(scope, { reviewUpdates: updates });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );
      const review = render(<WorkspacePage client={client} />);

      try {
        await userEvent.click(await screen.findByRole("button", { name: "Comment: Original feedback" }));
        const editor = await screen.findByRole("form", { name: "Edit comment" });
        const textarea = within(editor).getByLabelText("Comment text");
        await userEvent.clear(textarea);
        await userEvent.type(textarea, "Keep this local draft");

        await writeFile(
          join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(artifact))),
          JSON.stringify(annotations("New external feedback")),
        );
        expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment changed outside the app.");

        await userEvent.click(within(editor).getByRole("button", { name: "Keep mine" }));
        expect(textarea).toHaveValue("Keep this local draft");
        await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

        expect(await screen.findByRole("button", { name: "Comment: Keep this local draft" })).toBeInTheDocument();
      } finally {
        review.unmount();
        await updates.close();
      }
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
