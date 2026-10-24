import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import type { Artifact } from "@/features/artifact/artifact";
import { dependencyDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { installDiagramMeasurements } from "../../../tests/helpers/diagram-measurements";
import { renderWorkspace } from "../../../tests/helpers/render-workspace";
import { waitForDiagramReady } from "../../../tests/helpers/wait-for-diagram";
import { writeCatalog } from "../../../tests/helpers/write-catalog";

const diagram = {
  artifactId: ".architecture-companion/artifacts/dependencies.archcomp.json",
  type: "design",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Dependencies",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview grouped dependency relations.\n\n## Regeneration\nRebuild the source and target groups.",
  diagram: {
    layout: { layoutId: "dependency-graph" },
    graph: dependencyDiagramGraphSchema.parse({
      groups: [
        { groupId: "source", title: "Source" },
        { groupId: "target", title: "Target" },
      ],
      nodes: [
        { nodeId: "one", type: "default", title: "One", groupId: "source" },
        { nodeId: "two", type: "default", title: "Two", groupId: "source" },
        { nodeId: "other", type: "default", title: "Other", groupId: "target" },
      ],
      edges: [
        { edgeId: "one-other", type: "default", sourceNodeId: "one", targetNodeId: "other" },
        { edgeId: "two-other", type: "default", sourceNodeId: "two", targetNodeId: "other" },
        { edgeId: "one-two", type: "default", sourceNodeId: "one", targetNodeId: "two" },
      ],
    }),
  },
} satisfies Artifact;

async function createReview(beforeSave?: () => Promise<void>) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-dependency-focus-"));
  await writeCatalog(scopePath, { artifacts: [diagram] });
  const app = createApp(await resolveCompanionScope(scopePath));
  const client = createDataClient("http://architecture-companion.test", async (input, init) => {
    if (init?.method === "PUT") await beforeSave?.();
    return app.request(input, init);
  });
  const review = await renderWorkspace(client);
  const region = await screen.findByRole("region", { name: "Dependencies code design diagram" });
  await waitForDiagramReady(region);
  await within(region).findByRole("button", { name: "Show 2 edges from source to target" });
  return { scopePath, review, region };
}

describe("dependency graph focus", () => {
  let restoreMeasurements: () => void;
  beforeEach(() => {
    restoreMeasurements = installDiagramMeasurements();
  });
  afterEach(() => restoreMeasurements());
  it("focuses groups, nodes, and aggregate relations and clears focus", async () => {
    const { scopePath, review, region } = await createReview();
    try {
      fireEvent.click(within(region).getByLabelText("Group: Source"));
      expect(within(region).getByText("Focused on Source")).toBeInTheDocument();

      fireEvent.click(within(region).getByLabelText("One"));
      expect(within(region).getByText("Focused on One")).toBeInTheDocument();

      fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }));
      await userEvent.click(await within(region).findByRole("button", { name: "Show 2 edges from source to target" }));
      expect(within(region).getByText("2 edges: One → Other")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Comment" }));
      fireEvent.click(within(region).getByLabelText("Group: Source"));
      const composer = await within(region).findByRole("form", { name: "Add comment" });
      expect(within(region).getByText("2 edges: One → Other")).toBeInTheDocument();
      await userEvent.click(within(composer).getByRole("button", { name: "Cancel" }));
      fireEvent.click(within(region).getByLabelText("One"));
      await userEvent.click(
        within(await within(region).findByRole("form", { name: "Add comment" })).getByRole("button", {
          name: "Cancel",
        }),
      );
      fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }));
      expect(within(region).getByText("2 edges: One → Other")).toBeInTheDocument();
      await userEvent.click(
        within(await within(region).findByRole("form", { name: "Add comment" })).getByRole("button", {
          name: "Cancel",
        }),
      );

      await userEvent.click(screen.getByRole("button", { name: "Comment" }));
      await userEvent.click(within(region).getByRole("button", { name: "Clear focus" }));
      expect(within(region).queryByText(/Focused on|edges:/)).not.toBeInTheDocument();
      expect(within(region).getByRole("button", { name: "Show 2 edges from source to target" })).toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("does not enable focus when Comment is turned on during a pending edit save", async () => {
    let holdSave = false;
    let releaseSave = () => {};
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const { scopePath, review, region } = await createReview(async () => {
      if (holdSave) await pendingSave;
    });
    try {
      const commentTool = screen.getByRole("button", { name: "Comment" });
      await userEvent.click(commentTool);
      fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }));
      const composer = await within(region).findByRole("form", { name: "Add comment" });
      await userEvent.type(within(composer).getByLabelText("Comment text"), "Review dependencies");
      await userEvent.click(within(composer).getByRole("button", { name: "Post" }));
      const pin = await within(region).findByRole("button", { name: "Comment: Review dependencies" });
      await userEvent.click(commentTool);
      await userEvent.click(pin);
      const editor = await within(region).findByRole("form", { name: "Edit comment" });
      await userEvent.type(within(editor).getByLabelText("Comment text"), " together");
      holdSave = true;
      await userEvent.click(within(editor).getByRole("button", { name: "Save" }));
      await within(editor).findByRole("button", { name: "Saving…" });

      await userEvent.click(commentTool);
      expect(commentTool).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(within(region).getByLabelText("Group: Source"));
      fireEvent.click(within(region).getByLabelText("One"));
      fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }));
      expect(within(region).queryByText(/Focused on|edges:/)).not.toBeInTheDocument();
      expect(within(region).queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();

      releaseSave();
      await waitFor(() => expect(within(region).queryByRole("form", { name: "Edit comment" })).not.toBeInTheDocument());
      expect(within(region).getByRole("button", { name: "Comment: Review dependencies together" })).toBeInTheDocument();
    } finally {
      releaseSave();
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });
});
