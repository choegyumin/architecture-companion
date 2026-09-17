import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeViewAnnotationsCommand } from "@/cli/view-annotations.command";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { Artifact } from "@/features/artifact/artifact";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { createFileAnnotationRepository } from "@/server/file-annotation-repository";
import { ARTIFACT_RELATIVE_PATH } from "@/server/read-artifact";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

const artifact: Artifact = {
  version: 1,
  processes: [
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
  designs: [
    {
      id: "checkout-structure",
      title: "Checkout structure",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    },
  ],
};

function reviewedComments(): AnnotationDocument {
  return {
    version: 1,
    annotations: [
      {
        id: "annotation-workflow",
        anchor: { canvasId: "process:checkout", point: { x: 120, y: 90 } },
        comment: {
          id: "comment-workflow",
          author: { id: "reviewer-1", name: "Reviewer" },
          body: "The payment failure path is missing.",
          createdAt: "2026-09-16T00:00:00.000Z",
        },
      },
      {
        id: "annotation-structure",
        anchor: {
          canvasId: "design:checkout-structure",
          point: { x: 180, y: 120 },
          target: { type: "node", id: "checkout-page" },
        },
        comment: {
          id: "comment-structure",
          author: { id: "reviewer-1", name: "Reviewer" },
          body: "The checkout page also handles payment validation.",
          createdAt: "2026-09-16T00:01:00.000Z",
        },
      },
    ],
  };
}

describe("coding agent retrieves reviewer comments", () => {
  it("lists comments from a completed review scope to ground follow-up work", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-follow-up-"));
    const outputs: string[] = [];
    const document = reviewedComments();

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(artifact));
      const scope = await resolveConsumerScope(scopePath);
      await createFileAnnotationRepository(scope.path).save({
        artifactRevisionId: createArtifactRevisionId(artifact),
        document,
        expectedDocument: { version: 1, annotations: [] },
      });

      await executeViewAnnotationsCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs.at(0)?.endsWith("\n")).toBe(true);
      expect(JSON.parse(outputs.at(0) as string)).toEqual({
        artifactRevisionId: expect.stringMatching(/^[0-9a-f]{64}$/),
        document,
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
