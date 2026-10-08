import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "overlay-kit";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

const catalog = {
  behaviors: [
    {
      id: "checkout",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout workflow",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout submission.\n\n## Regeneration\nRebuild the checkout trigger from the order flow.",
      diagram: {
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout submitted" }],
          edges: [],
        },
      },
    },
  ],
  designs: [],
};

async function createReview() {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-reviewer-comments-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeCatalog(scopePath, catalog);
  const scope = await resolveCompanionScope(scopePath);

  return { scope, scopePath };
}

function renderWorkspace(scope: Awaited<ReturnType<typeof resolveCompanionScope>>) {
  const app = createApp(scope);
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );

  return render(
    <OverlayProvider>
      <WorkspacePage client={client} />
    </OverlayProvider>,
  );
}

async function getCanvas(regionName: string): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name: regionName });
  await waitForDiagramReady(region);
  return within(region).getByRole("group", { name: "Artifact canvas" });
}

describe("reviewer leaves feedback as diagram comments", () => {
  it("posts a comment on the canvas and still sees it after reopening the review", async () => {
    const { scope, scopePath } = await createReview();
    let review = renderWorkspace(scope);

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      fireEvent.click(await getCanvas("Checkout workflow product behavior diagram"), { clientX: 120, clientY: 90 });
      const composer = await screen.findByRole("form", { name: "Add comment" });
      await userEvent.type(within(composer).getByLabelText("Comment text"), "Please add a payment failure path.");
      await userEvent.click(within(composer).getByRole("button", { name: "Post" }));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Comment: Please add a payment failure path." })).toBeInTheDocument(),
      );

      review.unmount();
      review = renderWorkspace(scope);
      await getCanvas("Checkout workflow product behavior diagram");
      expect(
        await screen.findByRole("button", { name: "Comment: Please add a payment failure path." }),
      ).toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });
});
