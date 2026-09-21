import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { writeArtifact } from "@/server/write-artifact";

const artifact: Artifact = {
  behaviors: [
    {
      id: "checkout",
      title: "Workflow",
      generator: "built-in:freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout submitted" }],
        edges: [],
      },
    },
  ],
  designs: [
    {
      id: "catalog-structure",
      title: "Catalog structure",
      generator: "built-in:freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "catalog-page", kind: "component", title: "Catalog page" }],
        edges: [],
      },
    },
    {
      id: "checkout-structure",
      title: "Checkout structure",
      generator: "built-in:freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "checkout-page", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    },
  ],
};

function savedFeedbackDocument(body: string): AnnotationDocument {
  return {
    annotations: [
      {
        id: "annotation-1",
        anchor: {
          canvasId: "behavior:checkout",
          point: { x: 120, y: 80 },
        },
        comment: {
          id: "comment-1",
          author: { id: "reviewer", name: "Reviewer" },
          body,
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      },
    ],
  };
}

async function createReview(initialDocument?: AnnotationDocument) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comment-management-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeArtifact(scopePath, artifact);
  if (initialDocument) {
    await mkdir(join(scopePath, ".architecture-companion/annotations"));
    await writeFile(
      join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(artifact))),
      JSON.stringify(initialDocument),
    );
  }
  const scope = await resolveConsumerScope(scopePath);

  return { scopePath, scope };
}

function createClient(app: ReturnType<typeof createApp>) {
  return createDataClient("http://architecture-companion.test", async (input, init) => app.request(input, init));
}

async function getAnnotationDocument(client: ReturnType<typeof createClient>) {
  const annotations = await client.getAnnotations();
  if (!annotations.document) throw new Error("Expected active revision annotations.");
  return annotations.document;
}

async function getCanvas(regionName: string): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name: regionName });
  return within(region).getByRole("group", { name: "Diagram canvas" });
}

function renderWorkspace(client: ReturnType<typeof createClient>) {
  return render(
    <OverlayProvider>
      <WorkspacePage client={client} />
    </OverlayProvider>,
  );
}

async function placeComment(target: Element, body: string, point: Readonly<{ x: number; y: number }>) {
  fireEvent.click(target, { clientX: point.x, clientY: point.y });
  const composer = await screen.findByRole("form", { name: "Add comment" });
  await userEvent.type(within(composer).getByLabelText("Comment text"), body);
  await userEvent.click(within(composer).getByRole("button", { name: "Post" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument());
}

async function blockCommentWrites(scopePath: string): Promise<void> {
  await chmod(join(scopePath, ".architecture-companion"), 0o555);
}

async function unblockCommentWrites(scopePath: string): Promise<void> {
  await chmod(join(scopePath, ".architecture-companion"), 0o755);
}

describe("WorkspacePage comment management", () => {
  it("can cancel a comment draft in progress", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      const commentTool = await screen.findByRole("button", { name: "Comment" });
      await userEvent.click(commentTool);
      expect(commentTool).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: "Fit View" }));
      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();

      fireEvent.click(await getCanvas("Workflow product behavior diagram"), { clientX: 80, clientY: 60 });
      const composer = await screen.findByRole("form", { name: "Add comment" });
      await userEvent.type(within(composer).getByLabelText("Comment text"), "Discard this draft");
      await userEvent.click(within(composer).getByRole("button", { name: "Cancel" }));
      const confirmation = await screen.findByRole("alertdialog");
      await userEvent.click(within(confirmation).getByRole("button", { name: "Discard" }));

      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Comment: Discard this draft")).not.toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("confirms before closing a changed draft with Escape", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      fireEvent.click(await getCanvas("Workflow product behavior diagram"), { clientX: 80, clientY: 60 });
      const composer = await screen.findByRole("form", { name: "Add comment" });
      const textarea = within(composer).getByLabelText("Comment text");
      await userEvent.type(textarea, "Keep this draft");

      await userEvent.keyboard("{Escape}");
      const confirmation = await screen.findByRole("alertdialog");
      expect(textarea).toHaveValue("Keep this draft");

      await userEvent.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(textarea).toHaveValue("Keep this draft");

      await userEvent.keyboard("{Escape}");
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("confirms before canceling a changed comment edit", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await placeComment(await getCanvas("Workflow product behavior diagram"), "Saved comment", { x: 120, y: 90 });

      await userEvent.click(screen.getByRole("button", { name: "Comment: Saved comment" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.type(textarea, " with local changes");
      await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }));

      const confirmation = await screen.findByRole("alertdialog");
      expect(textarea).toHaveValue("Saved comment with local changes");
      await userEvent.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(textarea).toHaveValue("Saved comment with local changes");

      await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("form", { name: "Edit comment" })).not.toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("confirms before replacing a changed draft with a new position", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      const canvas = await getCanvas("Workflow product behavior diagram");
      fireEvent.click(canvas, { clientX: 80, clientY: 60 });
      const composer = await screen.findByRole("form", { name: "Add comment" });
      const textarea = within(composer).getByLabelText("Comment text");
      await userEvent.type(textarea, "Keep this draft");

      fireEvent.click(canvas, { clientX: 180, clientY: 100 });
      const confirmation = await screen.findByRole("alertdialog");
      expect(textarea).toHaveValue("Keep this draft");
      await userEvent.click(within(confirmation).getByRole("button", { name: "Discard" }));

      const nextComposer = await screen.findByRole("form", { name: "Add comment" });
      expect(within(nextComposer).getByLabelText("Comment text")).toHaveValue("");
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("separates comments per diagram", async () => {
    const { scopePath, scope } = await createReview();
    const client = createClient(createApp(scope));
    const review = renderWorkspace(client);

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await userEvent.click(screen.getByRole("tab", { name: "Code Design" }));
      await userEvent.click(await screen.findByRole("button", { name: "Checkout structure" }));
      await placeComment(await screen.findByLabelText("component: Checkout page"), "Review checkout structure", {
        x: 180,
        y: 140,
      });
      const checkoutAnnotation = (await getAnnotationDocument(client)).annotations.at(0);
      expect(checkoutAnnotation?.anchor.target).toEqual({
        type: "node",
        id: "checkout-page",
      });

      await userEvent.click(screen.getByRole("button", { name: "Catalog structure" }));
      expect(screen.queryByLabelText("Comment: Review checkout structure")).not.toBeInTheDocument();
      await placeComment(await getCanvas("Catalog structure code design diagram"), "Review catalog structure", {
        x: 220,
        y: 160,
      });
      expect((await getAnnotationDocument(client)).annotations.at(1)?.anchor).not.toHaveProperty("target");

      await userEvent.click(screen.getByRole("button", { name: "Checkout structure" }));
      expect(await screen.findByLabelText("Comment: Review checkout structure")).toBeInTheDocument();
      expect(screen.queryByLabelText("Comment: Review catalog structure")).not.toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("can save new content after canceling a comment edit", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await placeComment(await getCanvas("Workflow product behavior diagram"), "Review workflow trigger", {
        x: 120,
        y: 90,
      });

      const originalPin = screen.getByRole("button", { name: "Comment: Review workflow trigger" });
      await userEvent.click(originalPin);
      let editor = await screen.findByRole("form", { name: "Edit comment" });
      expect(within(editor).getByLabelText("Comment text")).toHaveFocus();
      await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
      expect(originalPin).toHaveFocus();

      await userEvent.click(originalPin);
      editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.clear(textarea);
      expect(within(editor).getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.type(textarea, "Keep the workflow trigger");
      await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("button", { name: "Comment: Keep the workflow trigger" })).toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("restores a moved comment position in a reopened review", async () => {
    const { scopePath, scope } = await createReview();
    const client = createClient(createApp(scope));
    let review = renderWorkspace(client);

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await placeComment(await getCanvas("Workflow product behavior diagram"), "Review workflow trigger", {
        x: 120,
        y: 90,
      });

      review.unmount();
      review = renderWorkspace(createClient(createApp(scope)));
      const pin = await screen.findByRole("button", { name: "Comment: Review workflow trigger" });
      const pointBeforeMove = (await getAnnotationDocument(client)).annotations.at(0)?.anchor.point;
      await userEvent.pointer([
        { keys: "[MouseLeft>]", target: pin, coords: { clientX: 120, clientY: 90 } },
        { target: pin, coords: { clientX: 260, clientY: 180 } },
        { keys: "[/MouseLeft]", target: pin, coords: { clientX: 260, clientY: 180 } },
      ]);
      await waitFor(async () => {
        expect((await getAnnotationDocument(client)).annotations.at(0)?.anchor.point).not.toEqual(pointBeforeMove);
      });
      const pointAfterMove = (await getAnnotationDocument(client)).annotations.at(0)?.anchor.point;

      review.unmount();
      review = renderWorkspace(createClient(createApp(scope)));
      expect(await screen.findByRole("button", { name: "Comment: Review workflow trigger" })).toBeInTheDocument();
      expect((await getAnnotationDocument(client)).annotations.at(0)?.anchor.point).toEqual(pointAfterMove);
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("does not restore a deleted comment in a reopened review", async () => {
    const { scopePath, scope } = await createReview();
    let review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await placeComment(await getCanvas("Workflow product behavior diagram"), "Review workflow trigger", {
        x: 120,
        y: 90,
      });
      review.unmount();
      review = renderWorkspace(createClient(createApp(scope)));

      await userEvent.click(await screen.findByRole("button", { name: "Comment: Review workflow trigger" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      await userEvent.click(within(editor).getByRole("button", { name: "Delete" }));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Comment: Review workflow trigger" })).not.toBeInTheDocument(),
      );

      review.unmount();
      review = renderWorkspace(createClient(createApp(scope)));
      await screen.findByRole("button", { name: "Comment" });
      expect(screen.queryByRole("button", { name: "Comment: Review workflow trigger" })).not.toBeInTheDocument();
    } finally {
      review.unmount();
      await rm(scopePath, { recursive: true });
    }
  });
});

describe("WorkspacePage comment save failures", () => {
  it("keeps the drafted text when saving a comment fails", async () => {
    const { scopePath, scope } = await createReview();
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
      await blockCommentWrites(scopePath);
      fireEvent.click(await getCanvas("Workflow product behavior diagram"), { clientX: 120, clientY: 90 });
      const composer = await screen.findByRole("form", { name: "Add comment" });
      const textarea = within(composer).getByLabelText("Comment text");
      await userEvent.type(textarea, "Keep this text");
      await userEvent.click(within(composer).getByRole("button", { name: "Post" }));

      expect(await within(composer).findByRole("alert")).toHaveTextContent("Comment could not be saved. Try again.");
      expect(textarea).toHaveValue("Keep this text");
    } finally {
      review.unmount();
      await unblockCommentWrites(scopePath);
      await rm(scopePath, { recursive: true });
    }
  });

  it("keeps the last saved text and the edit when updating fails, then retries", async () => {
    const { scopePath, scope } = await createReview(savedFeedbackDocument("Saved feedback"));
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Saved feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Retry this feedback");
      await blockCommentWrites(scopePath);
      await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

      expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment could not be updated. Try again.");
      expect(textarea).toHaveValue("Retry this feedback");
      expect(screen.getByRole("button", { name: "Comment: Saved feedback" })).toBeInTheDocument();

      await unblockCommentWrites(scopePath);
      await userEvent.click(within(editor).getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("button", { name: "Comment: Retry this feedback" })).toBeInTheDocument();
    } finally {
      review.unmount();
      await unblockCommentWrites(scopePath);
      await rm(scopePath, { recursive: true });
    }
  });

  it("keeps the edited text and the error when deleting a comment fails", async () => {
    const { scopePath, scope } = await createReview(savedFeedbackDocument("Saved feedback"));
    const review = renderWorkspace(createClient(createApp(scope)));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Saved feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      await blockCommentWrites(scopePath);
      await userEvent.click(within(editor).getByRole("button", { name: "Delete" }));

      expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment could not be deleted. Try again.");
      expect(within(editor).getByLabelText("Comment text")).toHaveValue("Saved feedback");
      expect(within(editor).getByRole("button", { name: "Delete" })).toBeEnabled();
    } finally {
      review.unmount();
      await unblockCommentWrites(scopePath);
      await rm(scopePath, { recursive: true });
    }
  });
});
