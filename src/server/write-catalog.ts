import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH } from "@/server/read-catalog";

type WritableArtifact = Readonly<{
  id: string;
  [key: string]: unknown;
}>;
type WritableArtifactCollection = readonly WritableArtifact[];

export type WritableCatalog = Readonly<{
  behaviors: WritableArtifactCollection;
  designs: WritableArtifactCollection;
}>;

const catalogKinds = [
  { relativePath: BEHAVIORS_RELATIVE_PATH, artifacts: "behaviors" },
  { relativePath: DESIGNS_RELATIVE_PATH, artifacts: "designs" },
] as const;

async function writeArtifactFile(scopePath: string, relativePath: string, artifact: WritableArtifact): Promise<void> {
  const directoryPath = join(scopePath, relativePath);
  const fileName = `${artifact.id}.json`;
  const temporaryPath = join(directoryPath, `.${artifact.id}-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, JSON.stringify(artifact), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, join(directoryPath, fileName));
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
  for (const { relativePath, artifacts } of catalogKinds) {
    const directoryPath = join(scopePath, relativePath);
    await mkdir(directoryPath, { recursive: true });

    const nextFileNames = new Set(catalog[artifacts].map(({ id }) => `${id}.json`));
    const previousEntries = await readdir(directoryPath).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [] as string[];
      throw error;
    });
    await Promise.all(
      previousEntries
        .filter((entry) => entry.endsWith(".json") && !nextFileNames.has(entry))
        .map((entry) => rm(join(directoryPath, entry), { force: true })),
    );

    await Promise.all(catalog[artifacts].map((artifact) => writeArtifactFile(scopePath, relativePath, artifact)));
  }
}
