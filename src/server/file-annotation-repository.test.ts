import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import type { AnnotationDocument } from "@/features/annotation/annotation-document";
import { parseArtifactRevisionId } from "@/features/artifact/artifact-revision-id";
import {
  AnnotationDocumentConflictError,
  createFileAnnotationRepository,
  getAnnotationDocumentRelativePath,
} from "@/server/file-annotation-repository";

const revisionA = parseArtifactRevisionId("a".repeat(64));
const revisionB = parseArtifactRevisionId("b".repeat(64));
const emptyDocument: AnnotationDocument = { version: 1, annotations: [] };

function document(body: string): AnnotationDocument {
  return {
    version: 1,
    annotations: [
      {
        id: `annotation-${body}`,
        anchor: { canvasId: "process:checkout", point: { x: 120, y: 80 } },
        comment: {
          id: `comment-${body}`,
          author: { id: "reviewer", name: "Reviewer" },
          body,
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      },
    ],
  };
}

type WorkerResult = Readonly<{ status: "fulfilled" }> | Readonly<{ status: "rejected"; name: string }>;

async function waitForFiles(paths: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const results = await Promise.allSettled(paths.map((path) => access(path)));
    if (results.every((result) => result.status === "fulfilled")) return;
    await delay(10);
  }

  throw new Error("Annotation save workers did not become ready.");
}

async function runSaveWorker(
  scopePath: string,
  workerName: string,
  startPath: string,
  body: string,
): Promise<WorkerResult> {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const scriptPath = join(scopePath, `${workerName}.ts`);
  const readyPath = join(scopePath, `${workerName}.ready`);
  const repositoryUrl = pathToFileURL(join(process.cwd(), "src/server/file-annotation-repository.ts")).href;
  const revisionUrl = pathToFileURL(join(process.cwd(), "src/features/artifact/artifact-revision-id.ts")).href;
  await writeFile(
    scriptPath,
    `
import { access, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createFileAnnotationRepository } from ${JSON.stringify(repositoryUrl)};
import { parseArtifactRevisionId } from ${JSON.stringify(revisionUrl)};

async function main() {
const [scopePath, readyPath, startPath, revisionSource, body] = process.argv.slice(2);
if (!scopePath || !readyPath || !startPath || !revisionSource || !body) throw new Error("Missing worker input.");
const artifactRevisionId = parseArtifactRevisionId(revisionSource);
const emptyDocument = { version: 1, annotations: [] };
const document = {
  version: 1,
  annotations: [{
    id: \`annotation-\${body}\`,
    anchor: { canvasId: "process:checkout", point: { x: 120, y: 80 } },
    comment: {
      id: \`comment-\${body}\`,
      author: { id: "reviewer", name: "Reviewer" },
      body,
      createdAt: "2026-08-28T00:00:00.000Z",
    },
  }],
};
await writeFile(readyPath, "");
while (true) {
  try {
    await access(startPath);
    break;
  } catch {
    await delay(5);
  }
}
try {
  await createFileAnnotationRepository(scopePath).save({
    artifactRevisionId,
    document,
    expectedDocument: emptyDocument,
    validateBeforeCommit: () => delay(150),
  });
  process.stdout.write(JSON.stringify({ status: "fulfilled" }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    status: "rejected",
    name: error instanceof Error ? error.name : "UnknownError",
  }));
}
}
void main();
`,
  );

  return new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "tsx", scriptPath, scopePath, readyPath, startPath, revisionA, body], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Annotation save worker exited with ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout) as WorkerResult);
    });
  });
}

describe("per-revision Annotation file repository", () => {
  test("saves revision files while preserving existing ignore entries", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeFile(join(scopePath, ".architecture-companion/.gitignore"), "artifact.local.json\n");
      const repository = createFileAnnotationRepository(scopePath);
      const saved = document("Saved");

      await repository.save({ artifactRevisionId: revisionA, document: saved, expectedDocument: emptyDocument });
      await repository.save({ artifactRevisionId: revisionA, document: saved, expectedDocument: saved });

      await expect(readFile(join(scopePath, getAnnotationDocumentRelativePath(revisionA)), "utf8")).resolves.toBe(
        `${JSON.stringify(saved, null, 2)}\n`,
      );
      await expect(readFile(join(scopePath, ".architecture-companion/.gitignore"), "utf8")).resolves.toBe(
        "artifact.local.json\n/annotations/\n",
      );
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("stores revision documents in isolation and restores them when the same revision returns", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-"));

    try {
      const repository = createFileAnnotationRepository(scopePath);
      const firstA = document("First A");
      const secondA = document("Second A");
      const savedB = document("B");

      await repository.save({ artifactRevisionId: revisionA, document: firstA, expectedDocument: emptyDocument });
      await repository.save({ artifactRevisionId: revisionB, document: savedB, expectedDocument: emptyDocument });
      await repository.save({ artifactRevisionId: revisionA, document: secondA, expectedDocument: firstA });

      const restored = createFileAnnotationRepository(scopePath);
      await expect(restored.load(revisionA)).resolves.toEqual(secondA);
      await expect(restored.load(revisionB)).resolves.toEqual(savedB);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects one stale document among concurrent saves", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-"));

    try {
      const firstRepository = createFileAnnotationRepository(scopePath);
      const secondRepository = createFileAnnotationRepository(scopePath);
      const first = document("First");
      const second = document("Second");

      const results = await Promise.allSettled([
        firstRepository.save({ artifactRevisionId: revisionA, document: first, expectedDocument: emptyDocument }),
        secondRepository.save({ artifactRevisionId: revisionA, document: second, expectedDocument: emptyDocument }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected.at(0)).toMatchObject({ reason: expect.any(AnnotationDocumentConflictError) });
      expect([first, second]).toContainEqual(await firstRepository.load(revisionA));
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("rejects one stale document among concurrent saves from different processes", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-"));
    const startPath = join(scopePath, "start");
    const readyPaths = [join(scopePath, "first.ready"), join(scopePath, "second.ready")];

    try {
      const workers = [
        runSaveWorker(scopePath, "first", startPath, "First"),
        runSaveWorker(scopePath, "second", startPath, "Second"),
      ];
      await waitForFiles(readyPaths);
      await writeFile(startPath, "");
      const results = await Promise.all(workers);

      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(results.find((result) => result.status === "rejected")).toEqual({
        status: "rejected",
        name: "AnnotationDocumentConflictError",
      });
      expect([document("First"), document("Second")]).toContainEqual(
        await createFileAnnotationRepository(scopePath).load(revisionA),
      );
    } finally {
      await rm(scopePath, { recursive: true });
    }
  }, 15_000);

  test("does not write outside the scope through a symlinked Annotation directory", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-annotations-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "architecture-companion-outside-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await symlink(outsidePath, join(scopePath, ".architecture-companion/annotations"), "dir");
      const repository = createFileAnnotationRepository(scopePath);

      await expect(
        repository.save({
          artifactRevisionId: revisionA,
          document: document("Blocked"),
          expectedDocument: emptyDocument,
        }),
      ).rejects.toThrow("Annotation storage path cannot be a symbolic link");
      await expect(readFile(join(outsidePath, `${revisionA}.json`), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all([rm(scopePath, { recursive: true }), rm(outsidePath, { recursive: true })]);
    }
  });
});
