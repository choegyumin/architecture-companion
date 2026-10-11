import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { artifactIdSchema } from "@/features/artifact/artifact";
import { ARTIFACTS_RELATIVE_PATH, readCatalog } from "@/server/read-catalog";

type WritableArtifact = Readonly<{
  artifactId: string;
  [key: string]: unknown;
}>;
type WritableArtifactCollection = readonly WritableArtifact[];

export type WritableCatalog = Readonly<{
  behaviors: WritableArtifactCollection;
  designs: WritableArtifactCollection;
}>;

async function writeArtifactFile(
  scopePath: string,
  artifact: WritableArtifact,
  kind: "behavior" | "design",
): Promise<void> {
  const { artifactId, ...document } = artifact;
  const filePath = join(scopePath, artifactIdSchema.parse(artifactId));
  const directoryPath = dirname(filePath);
  await mkdir(directoryPath, { recursive: true });
  const temporaryPath = join(directoryPath, `.${basename(filePath)}-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, JSON.stringify({ kind, ...document }), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // The temporary file may not exist or may already have been renamed.
    }
    throw error;
  }
}

export async function writeCatalog(scopePath: string, catalog: WritableCatalog): Promise<void> {
  const nextPaths = new Set(
    [...catalog.behaviors, ...catalog.designs].map(({ artifactId }) => artifactIdSchema.parse(artifactId)),
  );
  const previous = await readCatalog(scopePath);
  if (previous.status === "valid") {
    await Promise.all(
      [...previous.catalog.behaviors, ...previous.catalog.designs]
        .filter(({ artifactId }) => !nextPaths.has(artifactId))
        .map(({ artifactId }) => rm(join(scopePath, artifactId), { force: true })),
    );
  }

  await mkdir(join(scopePath, ARTIFACTS_RELATIVE_PATH), { recursive: true });
  await Promise.all([
    ...catalog.behaviors.map((artifact) => writeArtifactFile(scopePath, artifact, "behavior")),
    ...catalog.designs.map((artifact) => writeArtifactFile(scopePath, artifact, "design")),
  ]);
}
