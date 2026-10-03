import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createCatalogRevisionId } from "@/server/create-catalog-revision-id";
import {
  assertAnnotationDocumentPathIsSafe,
  getAnnotationDocumentRelativePath,
} from "@/server/file-annotation-repository";
import { readCatalog, type ReadCatalogResult } from "@/server/read-catalog";

export type ReviewUpdate = Readonly<{
  revision: number;
  status: ReadCatalogResult["status"];
}>;

type ReviewUpdateListener = (update: ReviewUpdate) => void;

export type ReviewUpdates = Readonly<{
  subscribe: (listener: ReviewUpdateListener) => () => void;
  close: () => Promise<void>;
}>;

type ReviewUpdateOptions = Readonly<{
  pollIntervalMs?: number;
}>;

type AnnotationFingerprint = string | null | Readonly<{ status: "unreadable"; reason: string }>;

type ReviewFiles = Readonly<{
  catalog: ReadCatalogResult;
  annotations: AnnotationFingerprint;
}>;

function getReadErrorReason(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : "Unknown Annotation read error.";
}

async function readAnnotations(scopePath: string, catalog: ReadCatalogResult): Promise<AnnotationFingerprint> {
  if (catalog.status !== "valid") return null;

  const catalogRevisionId = createCatalogRevisionId(catalog.catalog);
  const relativePath = getAnnotationDocumentRelativePath(catalogRevisionId);

  try {
    await assertAnnotationDocumentPathIsSafe(scopePath, catalogRevisionId);
    return await readFile(join(scopePath, relativePath), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    return { status: "unreadable", reason: getReadErrorReason(error) };
  }
}

async function readReviewFiles(scopePath: string): Promise<ReviewFiles | undefined> {
  const catalog = await readCatalog(scopePath);
  const annotations = await readAnnotations(scopePath, catalog);
  const latestCatalog = await readCatalog(scopePath);

  if (JSON.stringify(catalog) !== JSON.stringify(latestCatalog)) return undefined;
  return { catalog: latestCatalog, annotations };
}

function fingerprint(files: ReviewFiles): string {
  return JSON.stringify(files);
}

export async function createReviewUpdates(
  scopePath: string,
  options: ReviewUpdateOptions = {},
): Promise<ReviewUpdates> {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  let listeners: readonly ReviewUpdateListener[] = [];
  let revision = 0;
  let initialFiles: ReviewFiles | undefined;

  for (let attempt = 0; attempt < 10 && !initialFiles; attempt += 1) {
    initialFiles = await readReviewFiles(scopePath);
    if (!initialFiles) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!initialFiles) throw new Error("Review files did not stabilize before polling started.");
  let currentFingerprint = fingerprint(initialFiles);
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingScan = Promise.resolve();

  async function scan(): Promise<void> {
    const files = await readReviewFiles(scopePath);
    if (!files) return;

    const nextFingerprint = fingerprint(files);
    if (nextFingerprint === currentFingerprint) return;

    currentFingerprint = nextFingerprint;
    revision += 1;
    const update = { revision, status: files.catalog.status } as const;
    listeners.forEach((listener) => listener(update));
  }

  function schedule(): void {
    if (closed) return;
    timer = setTimeout(() => {
      pendingScan = scan().then(schedule, schedule);
    }, pollIntervalMs);
  }

  schedule();

  return {
    subscribe: (listener) => {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await pendingScan;
    },
  };
}
