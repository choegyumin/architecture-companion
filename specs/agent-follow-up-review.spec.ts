import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeViewAnnotationsCommand } from "@/cli/view-annotations.command";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import type { CompanionCatalog } from "@/features/catalog/catalog";
import { createCatalogRevisionId } from "@/server/create-catalog-revision-id";
import { createFileAnnotationRepository } from "@/server/file-annotation-repository";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { writeCatalog } from "../tests/helpers/write-catalog";

// Artifacts stay in the catalog's path-sorted order so the revision id
// computed here matches the one the server derives from the same files.
const catalog: CompanionCatalog = {
  artifacts: [
    {
      artifactId: ".architecture-companion/artifacts/checkout-structure.archcomp.json",
      type: "design",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview the checkout entry point.\n\n## Regeneration\nRebuild the checkout page boundary.",
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [{ nodeId: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
          edges: [],
        },
      },
    },
    {
      artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
      type: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout workflow",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout submission.\n\n## Regeneration\nRebuild the checkout trigger from the order flow.",
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [{ nodeId: "submit", type: "default", kind: "trigger", title: "Checkout submitted" }],
          edges: [],
        },
      },
    },
  ],
};

function reviewedComments(): AnnotationDocument {
  return {
    annotations: [
      {
        id: "annotation-workflow",
        anchor: {
          canvasId: "behavior:.architecture-companion/artifacts/checkout-workflow.archcomp.json",
          point: { x: 120, y: 90 },
        },
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
          canvasId: "design:.architecture-companion/artifacts/checkout-structure.archcomp.json",
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
      await writeCatalog(scopePath, catalog);
      const scope = await resolveCompanionScope(scopePath);
      await createFileAnnotationRepository(scope.path).save({
        catalogRevisionId: createCatalogRevisionId(catalog),
        document,
        expectedDocument: { annotations: [] },
      });

      await executeViewAnnotationsCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs.at(0)?.endsWith("\n")).toBe(true);
      expect(JSON.parse(outputs.at(0) as string)).toEqual({
        catalogRevisionId: expect.stringMatching(/^[0-9a-f]{64}$/),
        document,
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
