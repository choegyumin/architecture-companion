import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient, type DataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createApp } from "@/server/create-app";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { ARTIFACT_RELATIVE_PATH } from "@/server/read-artifact";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { createReviewUpdates } from "@/server/review-updates";

function artifact(label: string): Artifact {
  return {
    processes: [
      {
        title: "Workflow",
        generatorId: "freeform",
        layout: { id: "elk-layered", options: { direction: "RIGHT" } },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title: `${label} workflow` }],
          edges: [],
        },
        id: "checkout",
      },
    ],
    designs: [
      {
        id: "checkout-structure",
        title: "Checkout structure",
        generatorId: "freeform",
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [
            {
              type: "default",
              id: "checkout-page",
              kind: "component",
              title: `${label} component`,
              description: "Coordinates checkout",
              details: ["Submit the order"],
            },
          ],
          edges: [],
        },
      },
    ],
  };
}

async function writeArtifact(scopePath: string, input: unknown): Promise<void> {
  await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(input));
}

function annotationsFor(body = "Review the initial workflow."): AnnotationDocument {
  return {
    annotations: [
      {
        id: "process-feedback",
        anchor: {
          canvasId: "process:checkout",
          point: { x: 120, y: 80 },
        },
        comment: {
          id: "process-comment",
          author: { id: "reviewer", name: "Reviewer" },
          body,
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      },
    ],
  };
}

const emptyAnnotationDocument: AnnotationDocument = { annotations: [] };

async function writeAnnotations(
  scopePath: string,
  targetArtifact: Artifact,
  document: AnnotationDocument,
): Promise<void> {
  await mkdir(join(scopePath, ".architecture-companion/annotations"), { recursive: true });
  await writeFile(
    join(scopePath, getAnnotationDocumentRelativePath(createArtifactRevisionId(targetArtifact))),
    JSON.stringify(document),
  );
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function createReview(initialLabel: string, initialDocument?: AnnotationDocument) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-external-"));
  const initialArtifact = artifact(initialLabel);
  await mkdir(join(scopePath, ".architecture-companion"));
  if (initialDocument) await writeAnnotations(scopePath, initialArtifact, initialDocument);
  await writeArtifact(scopePath, initialArtifact);
  const scope = await resolveConsumerScope(scopePath);
  const updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
  const app = createApp(scope, { reviewUpdates: updates });
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const review = render(<WorkspacePage client={client} />);

  return {
    cleanup: async () => {
      review.unmount();
      await updates.close();
      await rm(scopePath, { recursive: true });
    },
    scopePath,
  };
}

describe("external artifact review", () => {
  it("applies a valid revision and hides comments from the previous revision", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-comments-"));
    const initialArtifact = artifact("Initial");
    const changedArtifact = artifact("Changed");

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeAnnotations(scopePath, initialArtifact, annotationsFor());
      await writeArtifact(scopePath, initialArtifact);
      const scope = await resolveConsumerScope(scopePath);
      const updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const app = createApp(scope, { reviewUpdates: updates });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );
      const review = render(<WorkspacePage client={client} />);

      try {
        expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
        expect(
          await screen.findByRole("button", { name: "Comment: Review the initial workflow." }),
        ).toBeInTheDocument();
        await userEvent.click(screen.getByRole("tab", { name: "Design" }));
        expect(await screen.findByText("Initial component")).toBeInTheDocument();

        await writeArtifact(scopePath, changedArtifact);
        expect(await screen.findByText("Changed component")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("tab", { name: "Process" }));
        expect(await screen.findByText("Changed workflow")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Comment: Review the initial workflow." })).not.toBeInTheDocument();
      } finally {
        review.unmount();
        await updates.close();
      }
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("keeps the last valid review when a change is invalid", async () => {
    const { cleanup, scopePath } = await createReview("Initial");

    try {
      expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), "{ partial");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Artifact contains invalid JSON: .architecture-companion/artifact.json",
      );
      expect(screen.getByText("Initial workflow")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
    } finally {
      await cleanup();
    }
  });

  it("recovers with a valid change after an error", async () => {
    const { cleanup, scopePath } = await createReview("Initial");

    try {
      expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), "{ partial");
      await screen.findByRole("alert");

      await writeArtifact(scopePath, artifact("Recovered"));
      expect(await screen.findByText("Recovered workflow")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("does not combine Review and Annotation responses from different revisions into one screen", async () => {
    const initialArtifact = artifact("Initial");
    const otherArtifact = artifact("Other");
    const initialRevisionId = createArtifactRevisionId(initialArtifact);
    const otherRevisionId = createArtifactRevisionId(otherArtifact);
    const scope = { isGitRepository: false, path: "/tmp/revision-mismatch" } as const;
    const reviews = [
      { scope, artifact: initialArtifact, artifactRevisionId: initialRevisionId },
      { scope, artifact: initialArtifact, artifactRevisionId: initialRevisionId },
    ] as const;
    const annotationReads = [
      { artifactRevisionId: otherRevisionId, document: annotationsFor("Wrong revision") },
      { artifactRevisionId: initialRevisionId, document: annotationsFor("Matched revision") },
    ] as const;
    let reviewIndex = 0;
    let annotationIndex = 0;
    const getReview = vi.fn(async () => reviews.at(reviewIndex++) ?? reviews.at(-1)!);
    const getAnnotations = vi.fn(async () => annotationReads.at(annotationIndex++) ?? annotationReads.at(-1)!);
    const client = {
      getReview,
      getAnnotations,
      saveAnnotations: vi.fn(),
      openSource: vi.fn(),
      subscribeToReviewUpdates: () => () => undefined,
    } as unknown as DataClient;
    const review = render(<WorkspacePage client={client} />);

    try {
      expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Comment: Matched revision" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Comment: Wrong revision" })).not.toBeInTheDocument();
      expect(getReview).toHaveBeenCalledTimes(2);
      expect(getAnnotations).toHaveBeenCalledTimes(2);
    } finally {
      review.unmount();
    }
  });

  it("shows an error after bounded retries when revision responses keep mismatching", async () => {
    const initialArtifact = artifact("Initial");
    const otherArtifact = artifact("Other");
    const scope = { isGitRepository: false, path: "/tmp/permanent-revision-mismatch" } as const;
    const getReview = vi.fn(async () => ({
      scope,
      artifact: initialArtifact,
      artifactRevisionId: createArtifactRevisionId(initialArtifact),
    }));
    const getAnnotations = vi.fn(async () => ({
      artifactRevisionId: createArtifactRevisionId(otherArtifact),
      document: annotationsFor("Wrong revision"),
    }));
    const client = {
      getReview,
      getAnnotations,
      saveAnnotations: vi.fn(),
      openSource: vi.fn(),
      subscribeToReviewUpdates: () => () => undefined,
    } as unknown as DataClient;
    const review = render(<WorkspacePage client={client} />);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Review and Annotation revisions did not match after reloading.",
      );
      expect(getReview).toHaveBeenCalledTimes(3);
      expect(getAnnotations).toHaveBeenCalledTimes(3);
    } finally {
      review.unmount();
    }
  });

  it("does not join Annotations to a Review without a revision", async () => {
    const scope = { isGitRepository: false, path: "/tmp/invalid-review" } as const;
    const getAnnotations = vi.fn();
    const client = {
      getReview: async () => ({
        scope,
        artifact: null,
        error: { message: "Artifact is invalid." },
      }),
      getAnnotations,
      saveAnnotations: vi.fn(),
      openSource: vi.fn(),
      subscribeToReviewUpdates: () => () => undefined,
    } as unknown as DataClient;
    const review = render(<WorkspacePage client={client} />);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("Artifact is invalid.");
      expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
      expect(getAnnotations).not.toHaveBeenCalled();
    } finally {
      review.unmount();
    }
  });

  it("does not let an earlier A save response overwrite the new A edit after an A→B→A transition", async () => {
    const initialArtifact = artifact("Initial");
    const changedArtifact = artifact("Changed");
    const initialRevisionId = createArtifactRevisionId(initialArtifact);
    const changedRevisionId = createArtifactRevisionId(changedArtifact);
    const saved = createDeferred<AnnotationDocument>();
    const scope = { isGitRepository: false, path: "/tmp/revision-transition" } as const;
    let currentReview = { scope, artifact: initialArtifact, artifactRevisionId: initialRevisionId };
    let currentAnnotations = {
      artifactRevisionId: initialRevisionId,
      document: annotationsFor(),
    };
    let publishUpdate: () => void = () => undefined;
    const saveAnnotations = vi.fn(() => saved.promise);
    const client = {
      getReview: async () => currentReview,
      getAnnotations: async () => currentAnnotations,
      saveAnnotations,
      openSource: vi.fn(),
      subscribeToReviewUpdates: (listener: () => void) => {
        publishUpdate = listener;
        return () => undefined;
      },
    } as unknown as DataClient;
    const review = render(<WorkspacePage client={client} />);

    try {
      expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Review the initial workflow." }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = screen.getByLabelText("Comment text");
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Saved after the revision changed");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(saveAnnotations).toHaveBeenCalledOnce());

      currentReview = { scope, artifact: changedArtifact, artifactRevisionId: changedRevisionId };
      currentAnnotations = {
        artifactRevisionId: changedRevisionId,
        document: { annotations: [] },
      };
      act(() => publishUpdate());

      expect(await screen.findByText("Changed workflow")).toBeInTheDocument();
      expect(editor).not.toBeInTheDocument();

      currentReview = { scope, artifact: initialArtifact, artifactRevisionId: initialRevisionId };
      currentAnnotations = {
        artifactRevisionId: initialRevisionId,
        document: annotationsFor("Reactivated revision"),
      };
      act(() => publishUpdate());

      expect(await screen.findByText("Initial workflow")).toBeInTheDocument();
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Reactivated revision" }));
      const reactivatedEditor = await screen.findByRole("form", { name: "Edit comment" });
      const reactivatedTextarea = screen.getByLabelText("Comment text");
      await userEvent.clear(reactivatedTextarea);
      await userEvent.type(reactivatedTextarea, "New draft on reactivated revision");

      await act(async () => {
        saved.resolve(annotationsFor("Saved after the revision changed"));
        await saved.promise;
      });

      expect(screen.getByText("Initial workflow")).toBeInTheDocument();
      expect(reactivatedEditor).toBeInTheDocument();
      expect(reactivatedTextarea).toHaveValue("New draft on reactivated revision");
    } finally {
      review.unmount();
    }
  });
});

describe("external comment review", () => {
  it("reloads a comment changed outside the app", async () => {
    const reviewArtifact = artifact("External");
    const { cleanup, scopePath } = await createReview("External");

    try {
      await screen.findByRole("button", { name: "Comment" });
      expect(screen.queryByRole("button", { name: "Comment: External feedback" })).not.toBeInTheDocument();

      await writeAnnotations(scopePath, reviewArtifact, annotationsFor("External feedback"));

      expect(await screen.findByRole("button", { name: "Comment: External feedback" })).toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("replaces the comment being edited with the external content when the external change is chosen", async () => {
    const reviewArtifact = artifact("Feedback");
    const { cleanup, scopePath } = await createReview("Feedback", annotationsFor("Original feedback"));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Original feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Local draft");

      await writeAnnotations(scopePath, reviewArtifact, annotationsFor("External feedback"));

      expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment changed outside the app.");
      expect(textarea).toHaveValue("Local draft");
      expect(within(editor).queryByText("External feedback")).not.toBeInTheDocument();
      expect(within(editor).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      expect(within(editor).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(within(editor).getByRole("button", { name: "Use external" })).toBeInTheDocument();
      expect(within(editor).getByRole("button", { name: "Keep mine" })).toBeInTheDocument();

      await userEvent.click(within(editor).getByRole("button", { name: "Use external" }));
      expect(textarea).toHaveValue("External feedback");
      expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("keeps the local draft over an external change and saves the local content", async () => {
    const reviewArtifact = artifact("Feedback");
    const { cleanup, scopePath } = await createReview("Feedback", annotationsFor("Original feedback"));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Original feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Keep this draft");

      await writeAnnotations(scopePath, reviewArtifact, annotationsFor("External feedback"));

      expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment changed outside the app.");
      expect(textarea).toHaveValue("Keep this draft");

      await userEvent.click(within(editor).getByRole("button", { name: "Keep mine" }));
      expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
      await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("button", { name: "Comment: Keep this draft" })).toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("restores a locally edited comment that was deleted outside the app", async () => {
    const reviewArtifact = artifact("Feedback");
    const { cleanup, scopePath } = await createReview("Feedback", annotationsFor("Original feedback"));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Original feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      const textarea = within(editor).getByLabelText("Comment text");
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Restore this draft");

      await writeAnnotations(scopePath, reviewArtifact, emptyAnnotationDocument);

      expect(await within(editor).findByRole("alert")).toHaveTextContent("Comment was deleted outside the app.");
      expect(textarea).toHaveValue("Restore this draft");
      expect(within(editor).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      expect(within(editor).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      await userEvent.click(within(editor).getByRole("button", { name: "Restore" }));

      expect(await screen.findByRole("button", { name: "Comment: Restore this draft" })).toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("discards the local draft when the comment being edited is deleted outside the app", async () => {
    const reviewArtifact = artifact("Feedback");
    const { cleanup, scopePath } = await createReview("Feedback", annotationsFor("Original feedback"));

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Comment: Original feedback" }));
      const editor = await screen.findByRole("form", { name: "Edit comment" });
      await writeAnnotations(scopePath, reviewArtifact, emptyAnnotationDocument);
      await within(editor).findByText("Comment was deleted outside the app.");
      await userEvent.click(within(editor).getByRole("button", { name: "Discard" }));

      expect(screen.queryByRole("form", { name: "Edit comment" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Comment:/ })).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });
});
