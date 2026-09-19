import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeViewAnnotationsCommand } from "@/cli/view-annotations.command";
import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import { createArtifactRevisionId } from "@/server/create-artifact-revision-id";
import { createFileAnnotationRepository, getAnnotationDocumentRelativePath } from "@/server/file-annotation-repository";
import { writeArtifact } from "@/server/write-artifact";

const checkoutBehavior = {
  id: "checkout",
  title: "Workflow",
  generatorId: "freeform",
  layout: { id: "elk-layered" },
  graph: {
    groups: [],
    nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout requested" }],
    edges: [],
  },
} as const;
const emptyArtifact = { behaviors: [], designs: [] };
const emptyDocument: AnnotationDocument = { annotations: [] };

describe("Active revision Annotation query command", () => {
  test("requires exactly one explicit scope argument", async () => {
    const outputs: string[] = [];
    const options = { writeStdout: (output: string) => outputs.push(output) };

    await expect(executeViewAnnotationsCommand([], options)).rejects.toThrow("Usage: node view-annotations.js <scope>");
    await expect(executeViewAnnotationsCommand(["first", "second"], options)).rejects.toThrow(
      "Usage: node view-annotations.js <scope>",
    );
    expect(outputs).toEqual([]);
  });

  test("prints a null envelope on one line when the artifact is missing", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-query-"));
    const outputs: string[] = [];

    try {
      await executeViewAnnotationsCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(['{"artifactRevisionId":null,"document":null}\n']);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("prints the active revision and an empty document when no Annotation document exists", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-query-"));
    const outputs: string[] = [];

    try {
      await writeArtifact(scopePath, emptyArtifact);

      await executeViewAnnotationsCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs.at(0)?.endsWith("\n")).toBe(true);
      expect(JSON.parse(outputs.at(0) as string)).toEqual({
        artifactRevisionId: expect.stringMatching(/^[0-9a-f]{64}$/),
        document: emptyDocument,
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("prints the Annotation document stored for the active revision", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-query-"));
    const outputs: string[] = [];
    const document: AnnotationDocument = {
      annotations: [
        {
          id: "annotation-1",
          anchor: { canvasId: "behavior:checkout", point: { x: 10, y: 20 } },
          comment: {
            id: "comment-1",
            author: { id: "reviewer-1", name: "Reviewer" },
            body: "Show the failure path.",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        },
      ],
    };

    try {
      await writeArtifact(scopePath, emptyArtifact);
      const artifactRevisionId = createArtifactRevisionId(emptyArtifact);
      await createFileAnnotationRepository(scopePath).save({
        artifactRevisionId,
        document,
        expectedDocument: emptyDocument,
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

  test("fails without stdout when the artifact is invalid", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-query-"));
    const outputs: string[] = [];

    try {
      await writeArtifact(scopePath, { behaviors: [{ ...checkoutBehavior, unexpected: true }], designs: [] });

      await expect(
        executeViewAnnotationsCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Artifact is invalid: .architecture-companion/behaviors/checkout.json.");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails without stdout when the active Annotation document cannot be read", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-query-"));
    const outputs: string[] = [];

    try {
      await writeArtifact(scopePath, emptyArtifact);
      const artifactRevisionId = createArtifactRevisionId(emptyArtifact);
      const annotationPath = join(scopePath, getAnnotationDocumentRelativePath(artifactRevisionId));
      await mkdir(join(annotationPath, ".."), { recursive: true });
      await writeFile(annotationPath, "{ invalid");

      await expect(
        executeViewAnnotationsCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Could not read active Annotation document.");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
