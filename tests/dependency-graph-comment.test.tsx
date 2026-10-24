import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import type { Artifact } from "@/features/artifact/artifact";
import { dependencyDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { installDiagramMeasurements } from "./helpers/diagram-measurements";
import { renderWorkspace } from "./helpers/render-workspace";
import { waitForDiagramReady } from "./helpers/wait-for-diagram";
import { writeCatalog } from "./helpers/write-catalog";

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

describe("dependency graph Comment snapshot", () => {
  let restoreMeasurements: () => void;
  beforeEach(() => {
    restoreMeasurements = installDiagramMeasurements();
  });
  afterEach(() => restoreMeasurements());

  it("publishes the clicked aggregate Anchor after focus changes and retains it while another edge is reviewed", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-dependency-comment-"));
    await writeCatalog(scopePath, { artifacts: [diagram] });
    const app = createApp(await resolveCompanionScope(scopePath));
    const client = createDataClient("http://architecture-companion.test", async (input, init) =>
      app.request(input, init),
    );
    const review = await renderWorkspace(client);

    try {
      const region = await screen.findByRole("region", { name: "Dependencies code design diagram" });
      await waitForDiagramReady(region);
      const aggregate = await within(region).findByRole("button", { name: "Show 2 edges from source to target" });
      const clicked = aggregate.getBoundingClientRect();
      const commentTool = screen.getByRole("button", { name: "Comment" });
      await userEvent.click(commentTool);
      await userEvent.click(aggregate);
      const composer = await within(region).findByRole("form", { name: "Add comment" });
      expect(within(region).queryByRole("button", { name: "Clear focus" })).not.toBeInTheDocument();

      await userEvent.click(commentTool);
      fireEvent.click(within(region).getByLabelText("One"));
      expect(within(region).getByText("Focused on One")).toBeInTheDocument();
      await userEvent.type(within(composer).getByLabelText("Comment text"), "Review both dependencies");
      await userEvent.click(within(composer).getByRole("button", { name: "Post" }));
      const pin = await within(region).findByRole("button", { name: "Comment: Review both dependencies" });
      const saved = (await client.getAnnotations()).document?.annotations.at(0)?.anchor;
      expect(saved).toEqual({
        canvasId: "design:.architecture-companion/artifacts/dependencies.archcomp.json",
        point: { x: expect.any(Number), y: expect.any(Number) },
        target: { type: "edge-set", sourceId: "source", targetId: "target", edgeIds: ["one-other", "two-other"] },
      });
      // The DOM environment supplies measurements, not physical hit testing.
      // Observe the rendered Pin at the activation point; native clicks are checked in the browser.
      expect(Number.parseFloat(pin.style.left)).toBeCloseTo(clicked.left + clicked.width / 2);
      expect(Number.parseFloat(pin.style.top)).toBeCloseTo(clicked.top + clicked.height / 2);

      fireEvent.click(within(region).getByRole("group", { name: "Artifact canvas" }));
      fireEvent.click(within(region).getByLabelText("One"));
      expect(within(region).getByText("Focused on One")).toBeInTheDocument();
      expect((await client.getAnnotations()).document?.annotations.at(0)?.anchor).toEqual(saved);

      await userEvent.click(commentTool);
      fireEvent.click(await within(region).findByLabelText("Edge from one to other"));
      const nextComposer = await within(region).findByRole("form", { name: "Add comment" });
      await userEvent.type(within(nextComposer).getByLabelText("Comment text"), "Review one dependency");
      await userEvent.click(within(nextComposer).getByRole("button", { name: "Post" }));
      await within(region).findByRole("button", { name: "Comment: Review one dependency" });
      const document = (await client.getAnnotations()).document;
      expect(document?.annotations).toHaveLength(2);
      expect(document?.annotations.at(0)?.anchor).toEqual(saved);
      expect(document?.annotations.at(1)?.anchor).toEqual({
        canvasId: "design:.architecture-companion/artifacts/dependencies.archcomp.json",
        point: { x: expect.any(Number), y: expect.any(Number) },
        target: { type: "edge", id: "one-other" },
      });
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });
});
