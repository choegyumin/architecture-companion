import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { type AnnotationDocument, parseAnnotationDocument } from "@/features/annotation/annotation-document";
import { type ArtifactRevisionId, parseArtifactRevisionId } from "@/features/artifact/artifact-revision-id";

export const ANNOTATIONS_DIRECTORY_RELATIVE_PATH = ".architecture-companion/annotations";

const ARCHITECTURE_COMPANION_RELATIVE_PATH = ".architecture-companion";
const GITIGNORE_RULE = "/annotations/";
const LOCK_RETRY_INTERVAL_MS = 10;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const emptyDocument: AnnotationDocument = { version: 1, annotations: [] };
const saveQueues = new Map<string, Promise<void>>();

type SaveAnnotationsInput = Readonly<{
  artifactRevisionId: ArtifactRevisionId;
  document: AnnotationDocument;
  expectedDocument: AnnotationDocument;
  validateBeforeCommit?: () => Promise<void>;
}>;

export type RevisionAnnotationRepository = Readonly<{
  load: (artifactRevisionId: ArtifactRevisionId) => Promise<AnnotationDocument>;
  save: (input: SaveAnnotationsInput) => Promise<void>;
}>;

export class AnnotationDocumentConflictError extends Error {
  constructor() {
    super("Annotation document changed before it could be saved.");
    this.name = "AnnotationDocumentConflictError";
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function assertNotSymbolicLink(path: string): Promise<void> {
  try {
    const statistics = await lstat(path);
    if (statistics.isSymbolicLink()) throw new Error("Annotation storage path cannot be a symbolic link.");
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return;
    throw error;
  }
}

type LockOwner = Readonly<{ pid: number; token: string }>;

function parseLockOwner(source: string): LockOwner | undefined {
  try {
    const input: unknown = JSON.parse(source);
    if (typeof input !== "object" || input === null || !("pid" in input) || !("token" in input)) {
      return undefined;
    }

    const { pid, token } = input;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
    if (typeof token !== "string" || token.length === 0) return undefined;
    return { pid, token };
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isFileSystemError(error, "ESRCH");
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  await assertNotSymbolicLink(lockPath);

  try {
    const [source, statistics] = await Promise.all([readFile(lockPath, "utf8"), lstat(lockPath)]);
    const owner = parseLockOwner(source);
    if (owner ? isProcessRunning(owner.pid) : Date.now() - statistics.mtimeMs < LOCK_STALE_MS) return false;
    await unlink(lockPath);
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return true;
    throw error;
  }
}

async function releaseFileLock(lockPath: string, token: string): Promise<void> {
  await assertNotSymbolicLink(lockPath);

  try {
    const owner = parseLockOwner(await readFile(lockPath, "utf8"));
    if (owner?.token === token) await unlink(lockPath);
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return;
    throw error;
  }
}

async function acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
  const token = randomUUID();
  const owner: LockOwner = { pid: process.pid, token };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    await assertNotSymbolicLink(lockPath);

    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      } catch (error) {
        await handle.close();
        await unlink(lockPath);
        throw error;
      }
      await handle.close();
      return () => releaseFileLock(lockPath, token);
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) throw error;
      if (await removeStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new AnnotationDocumentConflictError();
      await delay(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

async function writeFileAtomically(path: string, source: string, temporaryPrefix: string): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${temporaryPrefix}-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may not exist or may already have been renamed.
    }
    throw error;
  }
}

function addGitignoreRule(source: string): string {
  if (source.split(/\r?\n/).includes(GITIGNORE_RULE)) return source;
  const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
  return `${source}${separator}${GITIGNORE_RULE}\n`;
}

async function ensureGitignore(architectureCompanionPath: string): Promise<void> {
  const gitignorePath = join(architectureCompanionPath, ".gitignore");
  await assertNotSymbolicLink(gitignorePath);

  let source: string;
  try {
    source = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
    source = "";
  }

  const nextSource = addGitignoreRule(source);
  if (nextSource === source) return;
  await writeFileAtomically(gitignorePath, nextSource, "gitignore");
}

async function ensureStorage(scopePath: string): Promise<void> {
  const architectureCompanionPath = join(scopePath, ARCHITECTURE_COMPANION_RELATIVE_PATH);
  const annotationsPath = join(scopePath, ANNOTATIONS_DIRECTORY_RELATIVE_PATH);

  await assertNotSymbolicLink(architectureCompanionPath);
  await mkdir(architectureCompanionPath, { recursive: true });
  await assertNotSymbolicLink(architectureCompanionPath);
  await assertNotSymbolicLink(annotationsPath);
  await mkdir(annotationsPath, { recursive: true });
  await assertNotSymbolicLink(annotationsPath);
  await ensureGitignore(architectureCompanionPath);
}

async function serializeSave<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = saveQueues.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = previous.then(() => gate);
  saveQueues.set(key, queue);

  await previous;
  try {
    return await action();
  } finally {
    release();
    if (saveQueues.get(key) === queue) saveQueues.delete(key);
  }
}

export function getAnnotationDocumentRelativePath(artifactRevisionId: ArtifactRevisionId): string {
  const revisionId = parseArtifactRevisionId(artifactRevisionId);
  return join(ANNOTATIONS_DIRECTORY_RELATIVE_PATH, `${revisionId}.json`);
}

export async function assertAnnotationDocumentPathIsSafe(
  scopePath: string,
  artifactRevisionId: ArtifactRevisionId,
): Promise<void> {
  await assertNotSymbolicLink(join(scopePath, ARCHITECTURE_COMPANION_RELATIVE_PATH));
  await assertNotSymbolicLink(join(scopePath, ANNOTATIONS_DIRECTORY_RELATIVE_PATH));
  await assertNotSymbolicLink(join(scopePath, getAnnotationDocumentRelativePath(artifactRevisionId)));
}

export function createFileAnnotationRepository(scopePath: string): RevisionAnnotationRepository {
  const annotationsPath = join(scopePath, ANNOTATIONS_DIRECTORY_RELATIVE_PATH);

  const load = async (artifactRevisionId: ArtifactRevisionId): Promise<AnnotationDocument> => {
    const documentPath = join(scopePath, getAnnotationDocumentRelativePath(artifactRevisionId));
    await assertAnnotationDocumentPathIsSafe(scopePath, artifactRevisionId);

    try {
      return parseAnnotationDocument(JSON.parse(await readFile(documentPath, "utf8")));
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return emptyDocument;
      throw error;
    }
  };

  return {
    load,
    save: async ({ artifactRevisionId, document: input, expectedDocument: expectedInput, validateBeforeCommit }) => {
      const document = parseAnnotationDocument(input);
      const expectedDocument = parseAnnotationDocument(expectedInput);
      const documentPath = join(scopePath, getAnnotationDocumentRelativePath(artifactRevisionId));

      await serializeSave(annotationsPath, async () => {
        await ensureStorage(scopePath);
        const releaseLock = await acquireFileLock(`${documentPath}.lock`);

        try {
          const currentDocument = await load(artifactRevisionId);
          if (!isDeepStrictEqual(currentDocument, expectedDocument)) throw new AnnotationDocumentConflictError();

          await assertNotSymbolicLink(documentPath);
          const temporaryPath = join(annotationsPath, `.annotations-${randomUUID()}.tmp`);

          try {
            await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
              encoding: "utf8",
              flag: "wx",
            });
            const latestDocument = await load(artifactRevisionId);
            if (!isDeepStrictEqual(latestDocument, expectedDocument)) throw new AnnotationDocumentConflictError();
            await assertNotSymbolicLink(documentPath);
            await validateBeforeCommit?.();
            await rename(temporaryPath, documentPath);
          } catch (error) {
            try {
              await unlink(temporaryPath);
            } catch {
              // The temporary file may not exist or may already have been renamed.
            }
            throw error;
          }
        } finally {
          await releaseLock();
        }
      });
    },
  };
}
