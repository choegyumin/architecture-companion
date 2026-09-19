import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "overlay-kit";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
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
        nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout submitted" }],
        edges: [],
      },
    },
  ],
  designs: [],
};

async function createReview() {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-reviewer-comments-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeArtifact(scopePath, artifact);
  const scope = await resolveConsumerScope(scopePath);

  return { scope, scopePath };
}

function renderWorkspace(scope: Awaited<ReturnType<typeof resolveConsumerScope>>) {
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
  return within(region).getByRole("group", { name: "Diagram canvas" });
}

describe("reviewer leaves feedback as diagram comments", () => {
  it("posts a comment on the canvas and still sees it after reopening the review", async () => {
    const { scope, scopePath } = await createReview();
    const review = renderWorkspace(scope);

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
      renderWorkspace(scope);
      expect(
        await screen.findByRole("button", { name: "Comment: Please add a payment failure path." }),
      ).toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });
});
